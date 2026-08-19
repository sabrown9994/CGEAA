// Pure, I/O-free helpers for `zdf sync-diff`. No network calls, no filesystem access —
// fully unit-testable without mocks. See TODO.md → "PROPOSED FEATURE ... zdf sync-diff"
// for the authoritative spec and CLAUDE.md → "sync-diff feature (implementation context)"
// for wiring notes.
import { RESOURCE_SUBFOLDERS, OUTPUT_DIR } from '../constants.js';
import { checkTenantSupported, checkDeleteAllowed } from './delete-guard.js';

/** subfolder (e.g. "accounts") -> resource (e.g. "account"). Reverse of RESOURCE_SUBFOLDERS. */
export const REVERSE_SUBFOLDERS: Record<string, string> = Object.fromEntries(
  Object.entries(RESOURCE_SUBFOLDERS).map(([resource, subfolder]) => [subfolder, resource])
);

/**
 * Create/push order — parents first. Delete order is the exact reverse (children first).
 * Static and documented rather than resolved from the live dependency graph (spec decision).
 */
export const RESOURCE_PRECEDENCE: string[] = [
  'account',
  'contact',
  'product',
  'product-rate-plan',
  'product-rate-plan-charge',
  'order',
  'order-line-item',
  'subscription',
  'bill-run',
  'invoice',
  'credit-memo',
  'debit-memo',
  'workflow',
  'billing-template',
];

export type DiffStatus = 'A' | 'M' | 'D' | 'R' | 'C';
export type Op = 'create' | 'push' | 'delete';
export type PlanOp = Op | 'ignore';

export interface DiffEntry {
  status: DiffStatus;
  path: string;
  oldPath?: string;
}

export interface ResolvedAction {
  resource: string;
  id: string;
}

export interface IgnoredAction {
  ignored: true;
  reason: string;
}

export interface Eligibility {
  eligible: boolean;
  reason?: string;
}

export interface PlanItem {
  file: string;
  status: DiffStatus;
  resource: string | null;
  id: string | null;
  op: PlanOp;
  eligible: boolean;
  reason?: string;
}

/**
 * Parse `git diff --name-status` output into structured entries.
 * Handles `A\t<path>`, `M\t<path>`, `D\t<path>`, `R<score>\t<old>\t<new>`,
 * `C<score>\t<old>\t<new>`. Blank lines are ignored. Malformed lines are skipped
 * (never throws — sync-diff must never hard-fail on a parse issue).
 */
export function parseNameStatus(input: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const lines = input.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split('\t');
    const code = parts[0];
    if (!code) continue;
    const letter = code[0] as DiffStatus;

    if (letter === 'A' || letter === 'M' || letter === 'D') {
      const path = parts[1];
      if (!path) continue; // malformed — skip
      entries.push({ status: letter, path });
    } else if (letter === 'R' || letter === 'C') {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (!oldPath || !newPath) continue; // malformed — skip
      entries.push({ status: letter, path: newPath, oldPath });
    }
    // Unknown status letter — skip.
  }

  return entries;
}

/**
 * Split a root path into non-empty segments, normalizing away a leading `./` and any
 * leading/trailing slashes (e.g. `./zdf-output/` -> `['zdf-output']`,
 * `Zuora/zdf-output` -> `['Zuora', 'zdf-output']`).
 */
function normalizedRootSegments(root: string): string[] {
  let r = root.trim();
  if (r.startsWith('./')) r = r.slice(2);
  return r.split('/').filter((s) => s.length > 0 && s !== '.');
}

/**
 * Resolve a repo path to a resource + id, or an ignored result with a reason.
 *
 * Per spec rule 1 ("consider only paths inside the zdf-output root"), the path must be
 * anchored at `root`: it must match exactly `<root>/<subfolder>/<filename>`, where
 * `<subfolder>` is a known entry in REVERSE_SUBFOLDERS and `<filename>` sits directly
 * under it (no deeper nesting). Paths outside `root` are ignored, not misclassified.
 *
 * `root` defaults to the `OUTPUT_DIR` constant (`zdf-output`) when omitted — the same
 * default `getOutputDir()` uses absent a `ZDF_OUTPUT_DIR` override — so a bare
 * `resolveFileToAction(path)` call (e.g. in tests) still requires the conventional
 * `zdf-output/` prefix rather than matching any known subfolder anywhere in the path.
 */
export function resolveFileToAction(path: string, root: string = OUTPUT_DIR): ResolvedAction | IgnoredAction {
  const rootSegments = normalizedRootSegments(root);
  const segments = path.split('/').filter((s) => s.length > 0);

  if (segments.length !== rootSegments.length + 2) {
    return { ignored: true, reason: 'not under the zdf-output root' };
  }
  for (let i = 0; i < rootSegments.length; i++) {
    if (segments[i] !== rootSegments[i]) {
      return { ignored: true, reason: 'not under the zdf-output root' };
    }
  }

  const filename = segments[segments.length - 1];
  const subfolder = segments[segments.length - 2];
  const resource = REVERSE_SUBFOLDERS[subfolder];
  if (!resource) {
    return { ignored: true, reason: 'not under a known zdf-output subfolder' };
  }

  if (!filename.endsWith('.json')) {
    return { ignored: true, reason: 'not a .json file' };
  }

  if (resource === 'data-query') {
    return { ignored: true, reason: 'data-query excluded' };
  }

  const base = filename.slice(0, -'.json'.length);
  let id: string;
  if (resource === 'billing-template') {
    // filename is `<name>_<id>.json`; names may contain `_`, Zuora ids never do.
    const lastUnderscore = base.lastIndexOf('_');
    id = lastUnderscore === -1 ? base : base.slice(lastUnderscore + 1);
  } else {
    // Default, and `order` (the basename IS the order number) both use the bare basename.
    id = base;
  }

  return { resource, id };
}

/**
 * Determine whether an op is eligible to run for a resource. Never throws — all
 * ineligibility is reported via `{ eligible: false, reason }` so sync-diff can skip+warn
 * instead of hard-failing the whole run.
 */
export function eligibility(resource: string, op: Op): Eligibility {
  // Defensive/unreachable in practice: resolveFileToAction() already excludes data-query
  // paths (reason 'data-query excluded') before eligibility() is ever called on them. Kept
  // here so eligibility() is independently correct if ever called directly with 'data-query'.
  if (resource === 'data-query') {
    return { eligible: false, reason: 'excluded' };
  }
  if (resource === 'subscription' && (op === 'create' || op === 'delete')) {
    return { eligible: false, reason: 'no create/delete command for subscription' };
  }
  if (resource === 'bill-run' && op === 'create') {
    return { eligible: false, reason: 'create bill-run excluded (executes real billing)' };
  }
  if (resource === 'bill-run' && op === 'push') {
    return { eligible: false, reason: 'push bill-run is a re-fetch no-op' };
  }
  if (resource === 'order-line-item' && (op === 'create' || op === 'delete')) {
    return { eligible: false, reason: 'no create/delete command for order-line-item' };
  }
  if (resource === 'invoice' && op === 'create') {
    return {
      eligible: false,
      reason: 'create not supported via sync-diff (requires accounting fields / a source account body)',
    };
  }
  if ((resource === 'credit-memo' || resource === 'debit-memo') && op === 'create') {
    return { eligible: false, reason: 'create not supported via sync-diff (requires --invoice and item shape)' };
  }
  if (resource === 'billing-template' && op === 'create') {
    return { eligible: false, reason: 'create not supported via sync-diff (id is encoded in the filename)' };
  }

  if (op === 'create') {
    try {
      checkTenantSupported(resource, 'create');
    } catch (e) {
      return { eligible: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  if (op === 'delete') {
    try {
      checkDeleteAllowed(resource);
    } catch (e) {
      return { eligible: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  return { eligible: true };
}

function opGroup(op: PlanOp): number {
  if (op === 'create' || op === 'push') return 0;
  if (op === 'delete') return 1;
  return 2; // ignore — sorts last
}

function precedenceRank(resource: string | null, reverse: boolean): number {
  if (!resource) return Number.MAX_SAFE_INTEGER;
  const idx = RESOURCE_PRECEDENCE.indexOf(resource);
  if (idx === -1) return Number.MAX_SAFE_INTEGER;
  return reverse ? RESOURCE_PRECEDENCE.length - 1 - idx : idx;
}

function buildPlanItem(file: string, status: DiffStatus, op: Op, root: string | undefined): PlanItem {
  const resolved = resolveFileToAction(file, root);
  if ('ignored' in resolved) {
    return { file, status, resource: null, id: null, op: 'ignore', eligible: false, reason: resolved.reason };
  }
  const { resource, id } = resolved;
  const elig = eligibility(resource, op);
  return { file, status, resource, id, op, eligible: elig.eligible, reason: elig.reason };
}

/**
 * Build the ordered plan from parsed diff entries. `A`->create, `M`->push, `D`->delete.
 * `R` (rename) decomposes into delete(oldPath) + create(newPath). `C` (copy) -> create(newPath).
 * Every input entry is represented in the output (nothing is silently dropped) — unresolvable
 * or ineligible entries appear with `eligible:false` and a `reason` instead.
 *
 * Sort: creates+pushes first, in RESOURCE_PRECEDENCE order (parents-first); then deletes, in
 * reverse RESOURCE_PRECEDENCE order (children-first); ignored entries (unresolvable path) sort
 * last, in original input order. Ties within a group are broken by input order (stable sort).
 */
export function planFromDiff(entries: DiffEntry[], root?: string): PlanItem[] {
  const items: PlanItem[] = [];

  for (const entry of entries) {
    if (entry.status === 'R') {
      items.push(buildPlanItem(entry.oldPath as string, entry.status, 'delete', root));
      items.push(buildPlanItem(entry.path, entry.status, 'create', root));
    } else if (entry.status === 'C') {
      items.push(buildPlanItem(entry.path, entry.status, 'create', root));
    } else {
      const opMap: Record<'A' | 'M' | 'D', Op> = { A: 'create', M: 'push', D: 'delete' };
      items.push(buildPlanItem(entry.path, entry.status, opMap[entry.status], root));
    }
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const groupA = opGroup(a.item.op);
      const groupB = opGroup(b.item.op);
      if (groupA !== groupB) return groupA - groupB;
      if (groupA === 2) return a.index - b.index;

      const reverse = groupA === 1;
      const rankA = precedenceRank(a.item.resource, reverse);
      const rankB = precedenceRank(b.item.resource, reverse);
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
