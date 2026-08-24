import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, readResourceFileByIdOrName, renameResourceFile, resolveFilePath, getOutputDir, writeResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';
import { resolveTargetId, crossTenantKeyValue } from '../helpers/upsert.js';
import { stripEnvMap, activeEnvName, getEnvEntry, setEnvEntry } from '../helpers/env-map.js';
import { getOrCreate, capturePriorEnvMap, carryForwardEnvMap, carryForwardEnvMapToFile, deleteStaleSourceFile } from '../helpers/upsert-command.js';
import { toInvoiceCreateBody } from '../helpers/create-shape.js';

const RESOURCE = 'invoice';
const ENDPOINT = '/v1/invoices';

/** Resolves the accountNumber a cross-tenant invoice CREATE must carry, in the ACTIVE tenant.
 * A pulled invoice references its owning account by `accountId` — the SOURCE tenant's internal id —
 * and does NOT carry `accountNumber` at all (live-verified). So find the sibling local account file
 * (by accountId via findByStoredId's id-scan, or by accountNumber if one is somehow present) and
 * read its `_zdf[active].key` — the account's number in the target tenant. Throws BEFORE any Zuora
 * write if that account isn't seeded/mapped into the active env yet — there is no safe accountNumber
 * to create the invoice under otherwise. */
function resolveTargetAccountNumber(invoiceRecord: Record<string, unknown>): string {
  const active = activeEnvName();
  const accountId = invoiceRecord['accountId'];
  const accountNumber = invoiceRecord['accountNumber'];
  const ref = (typeof accountNumber === 'string' && accountNumber.trim()) ? accountNumber.trim()
    : (typeof accountId === 'string' && accountId.trim()) ? accountId.trim()
    : undefined;
  const acct = ref ? (readResourceFileByIdOrName('account', ref) as Record<string, unknown> | undefined) : undefined;
  const activeKey = acct ? getEnvEntry(acct, active)?.key : undefined;
  if (!acct || !activeKey) {
    throw new Error(
      `Cannot create invoice in ${active}: its account (${ref ?? 'unknown'}) is not mapped there — ` +
      `pull/push that account into ${active} first (zdf push account ...).`
    );
  }
  return String(activeKey);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('invoice <id>')
    .description('Fetch an invoice from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull invoice ${id} (see error above).`);
        }
        output.success(`Invoice ${id} written to ${getLastPulledPath() ?? resolveFilePath(RESOURCE, id)}`);
      })()
    );

  createCmd
    .command('invoice <name>')
    .description('Create a standalone invoice in Zuora from a local file')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/invoices/<name>.json)`)
    .option('--post', 'create the invoice in Posted status (a Posted invoice cannot be deleted via zdf on this tenant)')
    .action((name: string, opts: { file?: string; post?: boolean }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        // Captured BEFORE any mutation — see accounts.ts/products.ts create for why this must be
        // read straight off the in-memory record before stripEnvMap/setEnvEntry run.
        const priorMap = capturePriorEnvMap(body as Record<string, unknown> | undefined);
        if (opts.post && typeof body === 'object' && body !== null) {
          (body as Record<string, unknown>).status = 'Posted';
        }
        if (opts.post) {
          output.warn('--post creates the invoice in Posted status; a Posted invoice cannot be cancelled or deleted via zdf on this tenant.');
        }
        // `pull` writes `_zdf` into invoice files, so a create off a pulled file must never let it
        // reach Zuora — strip it from the outbound body on every post path (matches
        // accounts.ts/products.ts create).
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(ENDPOINT, stripEnvMap(body));
        assertSuccess(res, 'invoice create');
        if (!opts.file) {
          const fileRecord = body as Record<string, unknown>;
          const key = crossTenantKeyValue(RESOURCE, res as unknown as Record<string, unknown>) ?? crossTenantKeyValue(RESOURCE, fileRecord);
          setEnvEntry(fileRecord, activeEnvName(), { id: res.id, key });
          carryForwardEnvMap(fileRecord, priorMap);
          writeResourceFile(RESOURCE, name, fileRecord);
          renameResourceFile(RESOURCE, name, res.id);
        }
        output.success(`Invoice created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('invoice <id>')
    .description('Update an invoice in Zuora from a local file (upsert: creates if not found in the active tenant)')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileRecord = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        // Captured BEFORE the upsert — see env-map.ts / upsert-command.ts for why this must be
        // captured up front and carried forward explicitly after resolveAndSync's re-fetch/write.
        const priorMap = capturePriorEnvMap(fileRecord);
        const target = await resolveTargetId(RESOURCE, fileRecord);

        if (target.found) {
          // No account FK remap on the update branch: `accountNumber` is not in invoice's
          // updatable-fields allowlist (Zuora doesn't allow reassigning an invoice's account via
          // PUT), so filterUpdatableFields always strips it before it could ever reach the PUT
          // body. Requiring a mapped sibling account file here would be a pure UX regression — a
          // same-tenant `pull invoice` + `push invoice` (e.g. editing `comments`) doesn't pull the
          // parent account and has no cross-tenant intent, so it must not be forced to fail.
          const body = stripEnvMap(filterUpdatableFields(RESOURCE, fileRecord));
          const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${target.id}`, body);
          assertSuccess(res, 'invoice push');
          // resolveAndSync's re-fetch is the SOLE writer here (re-fetches + writes _zdf) — see
          // accounts.ts push for why a separate explicit write would risk a divergently-keyed file.
          await resolveAndSync(RESOURCE, target.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, target.id, priorMap);
          output.success(`Invoice ${target.id} updated.`);
        } else {
          // A raw pulled body (with embedded invoiceItems carrying ids/read-only fields) is not
          // the create shape POST /v1/invoices accepts — toInvoiceCreateBody adapts it into the
          // flat single-invoice create body (see zdf/CLAUDE.md "Invoice create / delete"). The
          // pulled invoice carries `accountId` (source-tenant internal id), NOT `accountNumber`, so
          // the FK to its account must be resolved to the ACTIVE tenant's accountNumber from the
          // sibling account file's `_zdf[active]` map and injected here (the adapter can't derive it).
          const targetAccountNumber = resolveTargetAccountNumber(fileRecord);
          const body = stripEnvMap(toInvoiceCreateBody(fileRecord));
          body['accountNumber'] = targetAccountNumber;
          const res = await apiPost<ZuoraWriteResponse & { id: string }>(ENDPOINT, body);
          assertSuccess(res, 'invoice create');
          await resolveAndSync(RESOURCE, res.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, res.id, priorMap);
          // Invoice is natural-keyed (invoiceNumber, tenant-assigned — NOT preserved from the
          // source). The file resolveAndSync just wrote is named by the NEW tenant's invoiceNumber,
          // which almost always differs from the source file's; delete the now-stale source so a
          // repeat `push <arg>` can't re-read it (still unmapped, still keyed by the OLD number)
          // and duplicate-create. No-op when the names happen to match.
          deleteStaleSourceFile(RESOURCE, id, fileRecord, res.id);
          output.success(`Invoice created. Zuora ID: ${res.id}`);
        }
      })()
    );

  deleteCmd
    .command('invoice <id>')
    .description('Delete an invoice in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const current = await apiGet<{ status?: string; success?: boolean }>(`${ENDPOINT}/${id}`);
        if (current.success === false) {
          throw new Error(`Invoice ${id} not found.`);
        }
        if (current.status === 'Posted') {
          throw new Error(
            `Invoice ${id} has status Posted and cannot be deleted on this tenant (only Draft invoices can be cancelled and deleted). Reverse a posted invoice with a credit memo instead.`
          );
        }
        output.info(`Cancelling invoice ${id} before delete...`);
        const cancelRes = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}/cancel`, {});
        if (!cancelRes.success) {
          const reasons = cancelRes.reasons ?? cancelRes.errors ?? [];
          const detail = reasons.length ? reasons.map((r) => r.message).join('; ') : 'unknown reason';
          output.warn(`Could not cancel invoice ${id} before delete: ${detail} — attempting delete anyway.`);
        }
        const res = await apiDelete<ZuoraWriteResponse & { jobId?: string }>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'invoice delete');
        if (res.jobId) {
          output.info(`Async delete started. Job ID: ${res.jobId}. Confirming deletion...`);
          await pollForDeletion(id);
        }
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Invoice ${id} deleted.`);
      })()
    );
}

// NOTE: DELETE /v1/invoices/{id} returns a jobId, but GET /v1/async-jobs/{jobId} does not
// recognize this job type (live-confirmed: always 200 with success:false / "Cannot find
// response for job..."). So instead of polling the async-jobs endpoint, we poll the invoice
// resource itself for disappearance — Zuora returns HTTP 200 { success: false, reasons: [...] }
// once the invoice is gone (live-confirmed).
async function pollForDeletion(id: string): Promise<void> {
  const POLL_INTERVAL_MS = 2000;
  const MAX_ATTEMPTS = 30;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const check = await apiGet<{ success?: boolean }>(`${ENDPOINT}/${id}`);
    if (check.success === false) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${MAX_ATTEMPTS} attempts waiting for invoice ${id} to be deleted.`);
}
