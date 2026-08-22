import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, readResourceFileIfExists, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';
import { resolveTargetId, matchInvoiceItems } from '../helpers/upsert.js';
import { stripEnvMap, activeEnvName, getEnvEntry } from '../helpers/env-map.js';
import { getOrCreate, capturePriorEnvMap, carryForwardEnvMapToFile } from '../helpers/upsert-command.js';

const RESOURCE = 'debit-memo';
const ENDPOINT = '/v1/debit-memos';
const ITEMS_KEY = 'debitMemoItems';

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
 * Throws BEFORE any Zuora write if that file is missing or not yet mapped into this env; there is
 * nothing safe to create the memo against otherwise. */
function resolveTargetInvoiceKey(sourceInvoiceId: string): string {
  const active = activeEnvName();
  const invoiceFile = readResourceFileIfExists('invoice', sourceInvoiceId) as Rec | undefined;
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
    .command('debit-memo <id>')
    .description('Fetch a debit memo from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull debit-memo ${id} (see error above).`);
        }
        output.success(`Debit memo ${id} written to ${getLastPulledPath() ?? resolveFilePath(RESOURCE, id)}`);
      })()
    );

  // Bare POST /v1/debit-memos is unreliable on this tenant (live-verified). Debit
  // memos must be created from a source invoice via the invoice-scoped endpoint,
  // POST /v1/debit-memos/invoice/{invoiceKey}. The caller must pass --invoice and
  // is responsible for including skuName in each item (live-verified requirement).
  createCmd
    .command('debit-memo <name>')
    .description('Create a debit memo in Zuora from a local file, scoped to a source invoice (--invoice)')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/debit-memos/<name>.json)`)
    .option('--invoice <invoiceId>', 'source invoice ID to create the debit memo from')
    .action((name: string, opts: { file?: string; invoice?: string }) =>
      runCommand(program, async () => {
        if (!opts.invoice) {
          throw new Error(
            'create debit-memo requires --invoice <invoiceId>. Debit memos must be created from a source invoice.'
          );
        }
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(`${ENDPOINT}/invoice/${opts.invoice}`, body);
        assertSuccess(res, 'debit-memo create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
        output.success(`Debit memo created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('debit-memo <id>')
    .description('Update a debit memo in Zuora from a local file (upsert: creates from a source invoice if not found in the active tenant)')
    .option('--invoice <invoiceId>', 'source invoice ID to create the debit memo from (only used when creating)')
    .action((id: string, opts: { invoice?: string }) =>
      runCommand(program, async () => {
        const fileRecord = readResourceFile(RESOURCE, id) as Rec;
        // Captured BEFORE the upsert — see env-map.ts / upsert-command.ts for why this must be
        // captured up front and carried forward explicitly after resolveAndSync's re-fetch/write.
        const priorMap = capturePriorEnvMap(fileRecord);
        const target = await resolveTargetId(RESOURCE, fileRecord);

        if (target.found) {
          // Header fields only — filterUpdatableFields' debit-memo allowlist has no items entry,
          // so debitMemoItems is stripped automatically; Zuora rejects items in a memo PUT anyway.
          const body = stripEnvMap(filterUpdatableFields(RESOURCE, fileRecord));
          const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${target.id}`, body);
          assertSuccess(res, 'debit-memo push');
          await resolveAndSync(RESOURCE, target.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, target.id, priorMap);
          output.success(`Debit memo ${target.id} updated.`);
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
          assertSuccess(res, 'debit-memo create');
          await resolveAndSync(RESOURCE, res.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, res.id, priorMap);
          output.success(`Debit memo created. Zuora ID: ${res.id}`);
        }
      })()
    );

  // Zuora only allows DELETE on a Canceled debit memo, and only a Draft memo can be
  // cancelled (status enum: Draft, Posted, Canceled, Error, PendingForTax, Generating,
  // CancelInProgress). Deletable path: Draft -> cancel -> delete; already-Canceled ->
  // delete directly; any other status is rejected with a clear message. Mirrors
  // credit-memo / invoice.
  deleteCmd
    .command('debit-memo <id>')
    .description('Delete a debit memo in Zuora (Draft memos are cancelled first; only Canceled memos are deletable)')
    .action((id: string) =>
      runCommand(program, async () => {
        const memo = await apiGet<{ success?: boolean; status?: string }>(`${ENDPOINT}/${id}`);
        assertReadSuccess(memo, 'debit-memo fetch');
        const status = memo.status;
        if (status === 'Draft') {
          const cancelled = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}/cancel`, {});
          assertSuccess(cancelled, 'debit-memo cancel');
        } else if (status !== 'Canceled') {
          throw new Error(
            `Debit memo ${id} has status ${status ?? 'unknown'} and cannot be deleted: only Draft ` +
            `debit memos (cancelled first) or already-Canceled memos are deletable. Reverse a posted ` +
            `debit memo through the normal accounting flow instead.`
          );
        }
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'debit-memo delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Debit memo ${id} deleted.`);
      })()
    );
}
