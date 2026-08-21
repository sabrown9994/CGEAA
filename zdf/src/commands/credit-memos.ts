import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';

const RESOURCE = 'credit-memo';
const ENDPOINT = '/v1/credit-memos';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
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
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(`${ENDPOINT}/invoice/${opts.invoice}`, body);
        assertSuccess(res, 'credit-memo create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
        output.success(`Credit memo created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('credit-memo <id>')
    .description('Update a credit memo in Zuora from a local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, fileData);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'credit-memo push');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Credit memo ${id} updated.`);
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
