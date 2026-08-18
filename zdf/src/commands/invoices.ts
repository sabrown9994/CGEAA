import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'invoice';
const ENDPOINT = '/v1/invoices';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
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
        output.success(`Invoice ${id} written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  createCmd
    .command('invoice <name>')
    .description('Create a standalone invoice in Zuora from a local file')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/invoices/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(ENDPOINT, body);
        assertSuccess(res, 'invoice create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
        output.success(`Invoice created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('invoice <id>')
    .description('Update an invoice in Zuora from a local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, fileData);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'invoice push');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Invoice ${id} updated.`);
      })()
    );

  deleteCmd
    .command('invoice <id>')
    .description('Delete an invoice in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
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
