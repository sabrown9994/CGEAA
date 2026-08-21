import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';

const RESOURCE = 'debit-memo';
const ENDPOINT = '/v1/debit-memos';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
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
    .description('Update a debit memo in Zuora from a local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, fileData);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'debit-memo push');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Debit memo ${id} updated.`);
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
