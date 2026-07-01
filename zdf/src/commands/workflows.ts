import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile, renameResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';

const RESOURCE = 'workflow';
const ENDPOINT = '/v1/api/workflows';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('workflow <id>')
    .description('Fetch a workflow from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const data = await apiGet<Record<string, unknown>>(`${ENDPOINT}/${id}`);
        const { success: _s, ...resource } = data;
        writeResourceFile(RESOURCE, id, resource);
        output.success(`Workflow ${id} written to zdf-output/workflows/${id}.json`);
      })()
    );

  createCmd
    .command('workflow <name>')
    .description('Create a workflow in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file (defaults to zdf-output/workflows/<name>.json)')
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { id: number }>(`${ENDPOINT}`, body);
        assertSuccess(res, 'workflow create');
        if (!opts.file) renameResourceFile(RESOURCE, name, String(res.id));
        output.success(`Workflow created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('workflow <id>')
    .description('Update a workflow in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawBody = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, rawBody);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'workflow update');
        output.success(`Workflow ${id} updated.`);
      })()
    );

  deleteCmd
    .command('workflow <id>')
    .description('Delete a workflow in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'workflow delete');
        output.success(`Workflow ${id} deleted.`);
      })()
    );
}
