import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, readResourceFileByIdOrName, renameResourceFile, resolveFilePath, getOutputDir, writeResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';
import { resolveTargetId, matchInvoiceItems, crossTenantKeyValue } from '../helpers/upsert.js';
import { stripEnvMap, activeEnvName, getEnvEntry, setEnvEntry } from '../helpers/env-map.js';
import { getOrCreate, capturePriorEnvMap, carryForwardEnvMap, carryForwardEnvMapToFile, deleteStaleSourceFile } from '../helpers/upsert-command.js';

const RESOURCE = 'credit-memo';
const ENDPOINT = '/v1/credit-memos';
const ITEMS_KEY = 'creditMemoItems';

type Rec = Record<string, unknown>;

/** Determines the SOURCE invoice id a memo-being-created should be built from: prefer the explicit
 * --invoice option, else look for `invoiceId` on the memo record's header or (per-item, the more
 * commonly populated spot) its items array — the most reliable field this tenant's memo body is
 * known to expose (see zdf/CLAUDE.md; UNCONFIRMED against live cross-tenant data). Throws if neither
 * is present — the create branch cannot proceed without a source invoice to remap from. */
function resolveSourceInvoiceId(fileRecord: Rec, explicitInvoiceId: string | undefined): string {
  if (explicitInvoiceId) return explicitInvoiceId;
  const direct = fileRecord['invoiceId'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const items = fileRecord[ITEMS_KEY] as Rec[] | undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      const v = item?.['invoiceId'];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  throw new Error(
    `create ${RESOURCE} requires --invoice <sourceInvoiceId>: the local file has no invoiceId to derive it from.`
  );
}

/** Resolves the source invoice's mapped key in the ACTIVE tenant — the invoice this memo will be
 * created against — by reading the sibling local invoice file and its `_zdf[activeEnv]` entry.
 * `sourceInvoiceId` may be EITHER the invoice's natural key (invoiceNumber — the file's actual
 * on-disk name) OR its internal Zuora id (e.g. when derived from a memo's `invoiceId` field, which
 * is an id, not a number) — `readResourceFileByIdOrName` resolves either. Throws BEFORE any Zuora
 * write if that file is missing or not yet mapped into this env; there is nothing safe to create
 * the memo against otherwise. */
function resolveTargetInvoiceKey(sourceInvoiceId: string): string {
  const active = activeEnvName();
  const invoiceFile = readResourceFileByIdOrName('invoice', sourceInvoiceId) as Rec | undefined;
  const entry = invoiceFile ? getEnvEntry(invoiceFile, active) : undefined;
  const key = entry?.key ?? entry?.id;
  if (!invoiceFile || !key) {
    throw new Error(
      `Cannot create ${RESOURCE} in ${active}: source invoice not mapped there — pull/push invoice ${sourceInvoiceId} into ${active} first.`
    );
  }
  return String(key);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('credit-memo <id>')
    .description('Fetch a credit memo from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull credit-memo ${id} (see error above).`);
        }
        output.success(`Credit memo ${id} written to ${getLastPulledPath() ?? resolveFilePath(RESOURCE, id)}`);
      })()
    );

  // Bare POST /v1/credit-memos is unreliable on this tenant (live-verified). Credit
  // memos must be created from a source invoice via the invoice-scoped endpoint,
  // POST /v1/credit-memos/invoice/{invoiceKey}. The caller must pass --invoice and
  // is responsible for including skuName in each item (live-verified requirement).
  createCmd
    .command('credit-memo <name>')
    .description('Create a credit memo in Zuora from a local file, scoped to a source invoice (--invoice)')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/credit-memos/<name>.json)`)
    .option('--invoice <invoiceId>', 'source invoice ID to create the credit memo from')
    .action((name: string, opts: { file?: string; invoice?: string }) =>
      runCommand(program, async () => {
        if (!opts.invoice) {
          throw new Error(
            'create credit-memo requires --invoice <invoiceId>. Credit memos must be created from a source invoice.'
          );
        }
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        // Captured BEFORE any mutation — see accounts.ts/products.ts create for why this must be
        // read straight off the in-memory record before stripEnvMap/setEnvEntry run.
        const priorMap = capturePriorEnvMap(body as Record<string, unknown> | undefined);
        // `pull` writes `_zdf` into credit-memo files, so a create off a pulled file must never
        // let it reach Zuora — strip it from the outbound body (matches accounts.ts/products.ts).
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(`${ENDPOINT}/invoice/${opts.invoice}`, stripEnvMap(body));
        assertSuccess(res, 'credit-memo create');
        if (!opts.file) {
          const fileRecord = body as Record<string, unknown>;
          const key = crossTenantKeyValue(RESOURCE, res as unknown as Record<string, unknown>) ?? crossTenantKeyValue(RESOURCE, fileRecord);
          setEnvEntry(fileRecord, activeEnvName(), { id: res.id, key });
          carryForwardEnvMap(fileRecord, priorMap);
          writeResourceFile(RESOURCE, name, fileRecord);
          renameResourceFile(RESOURCE, name, res.id);
        }
        output.success(`Credit memo created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('credit-memo <id>')
    .description('Update a credit memo in Zuora from a local file (upsert: creates from a source invoice if not found in the active tenant)')
    .option('--invoice <invoiceId>', 'source invoice ID to create the credit memo from (only used when creating)')
    .action((id: string, opts: { invoice?: string }) =>
      runCommand(program, async () => {
        const fileRecord = readResourceFile(RESOURCE, id) as Rec;
        // Captured BEFORE the upsert — see env-map.ts / upsert-command.ts for why this must be
        // captured up front and carried forward explicitly after resolveAndSync's re-fetch/write.
        const priorMap = capturePriorEnvMap(fileRecord);
        const target = await resolveTargetId(RESOURCE, fileRecord);

        if (target.found) {
          // Header fields only — filterUpdatableFields' credit-memo allowlist has no items entry,
          // so creditMemoItems is stripped automatically; Zuora rejects items in a memo PUT anyway.
          const body = stripEnvMap(filterUpdatableFields(RESOURCE, fileRecord));
          const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${target.id}`, body);
          assertSuccess(res, 'credit-memo push');
          await resolveAndSync(RESOURCE, target.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, target.id, priorMap);
          output.success(`Credit memo ${target.id} updated.`);
        } else {
          // R3: cross-tenant create from a source invoice. Both the target invoice key and each
          // item's invoiceItemId are SOURCE-tenant ids and must be remapped to the ACTIVE tenant
          // before any Zuora write — see resolveSourceInvoiceId / resolveTargetInvoiceKey above.
          const sourceInvoiceId = resolveSourceInvoiceId(fileRecord, opts.invoice);
          const targetInvoiceKey = resolveTargetInvoiceKey(sourceInvoiceId);
          const itemsRes = await apiGet<{ invoiceItems?: Rec[] }>(`/v1/invoices/${targetInvoiceKey}/items`);
          const targetItems = itemsRes.invoiceItems ?? [];
          const memoItems = (fileRecord[ITEMS_KEY] as Rec[] | undefined) ?? (fileRecord['items'] as Rec[] | undefined) ?? [];
          const matched = matchInvoiceItems(memoItems, targetItems);
          const res = await apiPost<ZuoraWriteResponse & { id: string }>(`${ENDPOINT}/invoice/${targetInvoiceKey}`, { items: matched });
          assertSuccess(res, 'credit-memo create');
          await resolveAndSync(RESOURCE, res.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, res.id, priorMap);
          // Credit memo is natural-keyed (memoNumber, tenant-assigned — NOT preserved from the
          // source). The file resolveAndSync just wrote is named by the NEW tenant's memoNumber,
          // which almost always differs from the source file's; delete the now-stale source so a
          // repeat `push <arg>` can't re-read it (still unmapped, still keyed by the OLD number)
          // and duplicate-create. No-op when the names happen to match.
          deleteStaleSourceFile(RESOURCE, id, fileRecord, res.id);
          output.success(`Credit memo created. Zuora ID: ${res.id}`);
        }
      })()
    );

  // Zuora only allows DELETE on a Canceled credit memo, and only a Draft memo can be
  // cancelled (status enum: Draft, Posted, Canceled, Error, PendingForTax, Generating,
  // CancelInProgress). So the deletable path is: Draft -> cancel -> delete; an
  // already-Canceled memo -> delete directly; any other status (Posted, Error, in-progress,
  // …) is rejected with a clear message rather than a doomed blind DELETE. This mirrors the
  // invoice cancel-then-delete flow. A Draft memo created from an invoice is NOT yet applied
  // (application happens on posting), so no unapply step is required.
  deleteCmd
    .command('credit-memo <id>')
    .description('Delete a credit memo in Zuora (Draft memos are cancelled first; only Canceled memos are deletable)')
    .action((id: string) =>
      runCommand(program, async () => {
        const memo = await apiGet<{ success?: boolean; status?: string }>(`${ENDPOINT}/${id}`);
        assertReadSuccess(memo, 'credit-memo fetch');
        const status = memo.status;
        if (status === 'Draft') {
          const cancelled = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}/cancel`, {});
          assertSuccess(cancelled, 'credit-memo cancel');
        } else if (status !== 'Canceled') {
          throw new Error(
            `Credit memo ${id} has status ${status ?? 'unknown'} and cannot be deleted: only Draft ` +
            `credit memos (cancelled first) or already-Canceled memos are deletable. Reverse a posted ` +
            `credit memo through the normal accounting flow instead.`
          );
        }
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'credit-memo delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Credit memo ${id} deleted.`);
      })()
    );
}
