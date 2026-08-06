import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

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
        output.success(`Credit memo ${id} written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  // Primary create endpoint is POST /v1/credit-memos, which supports both the
  // from-invoice shape ({ invoiceId, items: [...] }) and the from-charge shape
  // ({ accountId, charges: [...] }) depending on what the local file contains.
  // Zuora also exposes an invoice-scoped alternative, POST
  // /v1/credit-memos/invoice/{invoiceKey}, but this CLI always posts the file
  // body verbatim to the primary /v1/credit-memos endpoint.
  createCmd
    .command('credit-memo <name>')
    .description('Create a credit memo in Zuora from a local file')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/credit-memos/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(ENDPOINT, body);
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

  deleteCmd
    .command('credit-memo <id>')
    .description('Delete a credit memo in Zuora (must be Draft status)')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'credit-memo delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Credit memo ${id} deleted.`);
      })()
    );
}
