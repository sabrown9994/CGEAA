import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, readResourceFileIfExists, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';
import { resolveTargetId } from '../helpers/upsert.js';
import { stripEnvMap, activeEnvName, ENV_MAP_KEY, EnvMap } from '../helpers/env-map.js';
import { getOrCreate, capturePriorEnvMap, carryForwardEnvMapToFile } from '../helpers/upsert-command.js';

const RESOURCE = 'invoice';
const ENDPOINT = '/v1/invoices';

/** An invoice body references its owning account by `accountNumber` — a natural key that is the
 * SOURCE tenant's number. Resolves what that field should read in the ACTIVE tenant by looking up
 * the sibling local account file (natural-key-named by accountNumber) and reading its `_zdf[active]`
 * key. Throws (before any Zuora write) if that account hasn't been seeded/mapped into the active
 * env yet — there is nothing safe to substitute. Returns `undefined` when there's nothing to remap
 * (no accountNumber on the record at all). */
function resolveAccountRemap(sourceAccountNumber: string | undefined): { sourceAccountNumber: string; activeKey: string } | undefined {
  if (!sourceAccountNumber) return undefined;
  const active = activeEnvName();
  const acct = readResourceFileIfExists('account', sourceAccountNumber) as Record<string, unknown> | undefined;
  const activeKey = (acct?.[ENV_MAP_KEY] as EnvMap | undefined)?.[active]?.key ?? undefined;
  if (!acct || !activeKey) {
    throw new Error(
      `Cannot remap invoice's account to ${active}: seed/pull account ${sourceAccountNumber} into ${active} first (zdf pull account ... / zdf push account ...).`
    );
  }
  return { sourceAccountNumber, activeKey };
}

/** Applies a resolved account remap to an outbound body's `accountNumber`, if present — a no-op
 * when the active-env key matches the source (nothing to change) or the field isn't in the body
 * (e.g. stripped by filterUpdatableFields, which doesn't allowlist accountNumber for invoice PUT). */
function applyAccountRemap(
  body: Record<string, unknown>,
  remap: { sourceAccountNumber: string; activeKey: string } | undefined
): Record<string, unknown> {
  if (!remap || remap.activeKey === remap.sourceAccountNumber) return body;
  if (!('accountNumber' in body)) return body;
  return { ...body, accountNumber: remap.activeKey };
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
        if (opts.post && typeof body === 'object' && body !== null) {
          (body as Record<string, unknown>).status = 'Posted';
        }
        if (opts.post) {
          output.warn('--post creates the invoice in Posted status; a Posted invoice cannot be cancelled or deleted via zdf on this tenant.');
        }
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(ENDPOINT, body);
        assertSuccess(res, 'invoice create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
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
        // R2: resolve (and fail fast on, before any Zuora write) the account FK remap. Done before
        // resolveTargetId so an unmapped account never even reaches a Zuora call.
        const remap = resolveAccountRemap(fileRecord['accountNumber'] as string | undefined);
        const target = await resolveTargetId(RESOURCE, fileRecord);

        if (target.found) {
          const body = applyAccountRemap(stripEnvMap(filterUpdatableFields(RESOURCE, fileRecord)), remap);
          const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${target.id}`, body);
          assertSuccess(res, 'invoice push');
          // resolveAndSync's re-fetch is the SOLE writer here (re-fetches + writes _zdf) — see
          // accounts.ts push for why a separate explicit write would risk a divergently-keyed file.
          await resolveAndSync(RESOURCE, target.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, target.id, priorMap);
          output.success(`Invoice ${target.id} updated.`);
        } else {
          const body = applyAccountRemap(stripEnvMap(fileRecord), remap);
          const res = await apiPost<ZuoraWriteResponse & { id: string }>(ENDPOINT, body);
          assertSuccess(res, 'invoice create');
          await resolveAndSync(RESOURCE, res.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, res.id, priorMap);
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
