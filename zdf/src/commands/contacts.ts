import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'contact';
const ENDPOINT = '/v1/contacts';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('contact <id>')
    .description('Fetch a contact from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Contact ${id} written to zdf-output/contacts/${id}.json`);
      })()
    );

  createCmd
    .command('contact <name>')
    .description('Create a contact in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file (defaults to zdf-output/contacts/<name>.json)')
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { Id: string }>(`${ENDPOINT}`, body);
        assertSuccess(res, 'contact create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.Id);
        output.success(`Contact created. Zuora ID: ${res.Id}`);
      })()
    );

  pushCmd
    .command('contact <id>')
    .description('Update a contact in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawBody = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, rawBody);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'contact update');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Contact ${id} updated.`);
      })()
    );

  deleteCmd
    .command('contact <id>')
    .description('Delete a contact in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'contact delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Contact ${id} deleted.`);
      })()
    );
}
