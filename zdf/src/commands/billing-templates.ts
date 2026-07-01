import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile, renameResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';

const RESOURCE = 'billing-template';
const ENDPOINT = '/v1/billing-documents/templates';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('billing-template <id>')
    .description('Fetch a billing template from Zuora by internal ID (invoice, credit memo, debit memo)')
    .action((id: string) =>
      runCommand(program, async () => {
        const data = await apiGet<Record<string, unknown>>(`${ENDPOINT}/${id}`);
        const { success: _s, ...resource } = data;
        writeResourceFile(RESOURCE, id, resource);
        output.success(`Billing template ${id} written to zdf-output/billing-templates/${id}.json`);
      })()
    );

  createCmd
    .command('billing-template <name>')
    .description('Create a billing template in Zuora from a local file (invoice, credit memo, debit memo)')
    .option('-f, --file <path>', 'path to JSON file (defaults to zdf-output/billing-templates/<name>.json)')
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(`${ENDPOINT}`, body);
        assertSuccess(res, 'billing template create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
        output.success(`Billing template created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('billing-template <id>')
    .description('Update a billing template in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawBody = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, rawBody);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'billing template update');
        output.success(`Billing template ${id} updated.`);
      })()
    );

  deleteCmd
    .command('billing-template <id>')
    .description('Delete a billing template in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'billing template delete');
        output.success(`Billing template ${id} deleted.`);
      })()
    );
}
