import { Command } from 'commander';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { runCommand } from '../helpers/command-runner.js';
import { getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { parseNameStatus, planFromDiff } from '../helpers/sync-diff.js';
import type { Op, PlanItem } from '../helpers/sync-diff.js';

interface SyncDiffOpts {
  dryRun?: boolean;
  apply?: boolean;
  diffFile?: string;
  format?: string;
  root?: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function summary(plan: PlanItem[]): string {
  const toCreate = plan.filter((p) => p.op === 'create' && p.eligible).length;
  const toPush = plan.filter((p) => p.op === 'push' && p.eligible).length;
  const toDelete = plan.filter((p) => p.op === 'delete' && p.eligible).length;
  const skipped = plan.filter((p) => !p.eligible).length;
  return `${toCreate} to create, ${toPush} to push, ${toDelete} to delete, ${skipped} skipped`;
}

function renderText(plan: PlanItem[]): string {
  if (plan.length === 0) return 'No changes to plan.\n\n0 to create, 0 to push, 0 to delete, 0 skipped';
  const lines = plan.map((p) => {
    const target = [p.resource, p.id].filter(Boolean).join(' ');
    const state = p.eligible ? 'eligible' : `SKIPPED (${p.reason ?? 'ineligible'})`;
    return `[${p.status}] ${p.file} -> ${p.op}${target ? ` ${target}` : ''} — ${state}`;
  });
  return [...lines, '', summary(plan)].join('\n');
}

function renderMarkdown(plan: PlanItem[]): string {
  const header = '| file | status | resource | id | op | eligible | reason |';
  const sep = '|---|---|---|---|---|---|---|';
  const rows = plan.map(
    (p) =>
      `| ${p.file} | ${p.status} | ${p.resource ?? ''} | ${p.id ?? ''} | ${p.op} | ${p.eligible} | ${p.reason ?? ''} |`
  );
  return [header, sep, ...rows, '', summary(plan)].join('\n');
}

function renderJson(plan: PlanItem[]): string {
  return JSON.stringify(plan, null, 2);
}

function render(plan: PlanItem[], format: string): string {
  if (format === 'markdown') return renderMarkdown(plan);
  if (format === 'json') return renderJson(plan);
  return renderText(plan);
}

/** An executed or skipped plan item, carrying the outcome of `--apply`. */
export interface ApplyResult extends PlanItem {
  /** true if a child process was actually spawned for this item (i.e. it was eligible). */
  executed: boolean;
  /** Child process exit code (only present when `executed` is true). null = killed by signal. */
  exitCode?: number | null;
  /** true when skipped (never fails the run), or executed and exited 0. */
  ok: boolean;
}

/**
 * Spawn the compiled CLI as a child process for a single eligible action, inheriting auth env
 * vars. `--no-dependency` is required — this is object-only execution with no child re-pull, to
 * avoid rewriting local files / CI commit loops. Returns the child's exit code; a null status
 * (killed by signal) or a spawn error (e.g. ENOENT) is treated as a failure (1).
 */
export function runAction(cliEntry: string, op: Op, resource: string, id: string): number {
  const result = spawnSync(process.execPath, [cliEntry, op, resource, id, '--no-dependency'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    output.error(`Failed to spawn ${op} ${resource} ${id}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Execute every ELIGIBLE item in `plan`, in planned order, via `runAction`. Ineligible/ignored
 * items are logged (warn) and never spawned or counted as failures. Returns per-item results
 * plus whether any ELIGIBLE action failed (the sole driver of the command's exit code).
 */
export function applyPlan(plan: PlanItem[], cliEntry: string): { results: ApplyResult[]; failed: boolean } {
  const results: ApplyResult[] = [];
  let failed = false;

  for (const item of plan) {
    if (item.eligible && item.op !== 'ignore') {
      const target = [item.resource, item.id].filter(Boolean).join(' ');
      output.info(`Applying ${item.op} ${target}...`);
      const exitCode = runAction(cliEntry, item.op, item.resource as string, item.id as string);
      const ok = exitCode === 0;
      if (ok) {
        output.success(`${item.op} ${target} succeeded`);
      } else {
        output.error(`${item.op} ${target} failed (exit ${exitCode})`);
        failed = true;
      }
      results.push({ ...item, executed: true, exitCode, ok });
    } else {
      output.warn(`Skipping ${item.file} (${item.reason ?? 'ineligible'})`);
      results.push({ ...item, executed: false, ok: true });
    }
  }

  return { results, failed };
}

function applySummary(results: ApplyResult[]): string {
  const createdOk = results.filter((r) => r.executed && r.op === 'create' && r.ok).length;
  const pushedOk = results.filter((r) => r.executed && r.op === 'push' && r.ok).length;
  const deletedOk = results.filter((r) => r.executed && r.op === 'delete' && r.ok).length;
  const skipped = results.filter((r) => !r.executed).length;
  const failed = results.filter((r) => r.executed && !r.ok).length;
  return `${createdOk} created, ${pushedOk} pushed, ${deletedOk} deleted, ${skipped} skipped, ${failed} failed`;
}

function renderApplyText(results: ApplyResult[]): string {
  if (results.length === 0) return 'No changes to apply.\n\n0 created, 0 pushed, 0 deleted, 0 skipped, 0 failed';
  const lines = results.map((r) => {
    const target = [r.resource, r.id].filter(Boolean).join(' ');
    const state = !r.executed
      ? `SKIPPED (${r.reason ?? 'ineligible'})`
      : r.ok
        ? `OK (exit ${r.exitCode})`
        : `FAILED (exit ${r.exitCode})`;
    return `[${r.status}] ${r.file} -> ${r.op}${target ? ` ${target}` : ''} — ${state}`;
  });
  return [...lines, '', applySummary(results)].join('\n');
}

function renderApplyMarkdown(results: ApplyResult[]): string {
  const header = '| file | status | resource | id | op | executed | ok | exitCode | reason |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
  const rows = results.map(
    (r) =>
      `| ${r.file} | ${r.status} | ${r.resource ?? ''} | ${r.id ?? ''} | ${r.op} | ${r.executed} | ${r.ok} | ${
        r.exitCode ?? ''
      } | ${r.reason ?? ''} |`
  );
  return [header, sep, ...rows, '', applySummary(results)].join('\n');
}

function renderApplyJson(results: ApplyResult[]): string {
  return JSON.stringify(results, null, 2);
}

function renderApply(results: ApplyResult[], format: string): string {
  if (format === 'markdown') return renderApplyMarkdown(results);
  if (format === 'json') return renderApplyJson(results);
  return renderApplyText(results);
}

export function register(program: Command): void {
  program
    .command('sync-diff')
    .description('Map a git diff --name-status of the zdf-output tree to zdf create/push/delete actions (CI/CD)')
    .option('--dry-run', 'resolve and print the plan without executing anything (default)')
    .option('--apply', 'execute the planned eligible actions (spawns the CLI per action, --no-dependency)')
    .option('--diff-file <path>', 'path to a file containing git diff --name-status output (default: read stdin)')
    .option('--format <fmt>', 'output format: text|markdown|json', 'text')
    .option('--root <dir>', 'zdf-output root directory (default: resolved via getOutputDir())')
    .action((opts: SyncDiffOpts) =>
      runCommand(program, async () => {
        if (opts.apply && opts.dryRun) {
          throw new Error('sync-diff: --apply and --dry-run are mutually exclusive. Pass only one.');
        }

        const raw = opts.diffFile ? readFileSync(opts.diffFile, 'utf-8') : await readStdin();
        const root = opts.root ?? getOutputDir();
        const entries = parseNameStatus(raw);
        const plan = planFromDiff(entries, root);

        if (opts.apply) {
          const cliEntry = process.argv[1];
          const { results, failed } = applyPlan(plan, cliEntry);
          console.log(renderApply(results, opts.format ?? 'text'));
          if (failed) {
            throw new Error('sync-diff --apply: one or more eligible actions failed. See results above.');
          }
          return;
        }

        console.log(render(plan, opts.format ?? 'text'));
      })()
    );
}
