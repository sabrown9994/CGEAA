import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'product-rate-plan';
const OBJECT_ENDPOINT = '/v1/object/product-rate-plan';
const CREATE_ENDPOINT = '/v1/rateplan';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('product-rate-plan <id>')
    .description('Fetch a product rate plan from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Product rate plan ${id} written to zdf-output/product-rate-plans/${id}.json`);
      })()
    );

  createCmd
    .command('product-rate-plan <name>')
    .description('Create a product rate plan in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file (defaults to zdf-output/product-rate-plans/<name>.json)')
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { id: string }>(`${CREATE_ENDPOINT}`, body);
        assertSuccess(res, 'product rate plan create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
        output.success(`Product rate plan created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('product-rate-plan <id>')
    .description('Update a product rate plan in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawBody = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, rawBody);
        const res = await apiPut<{ Success: boolean; Errors?: Array<{ Code: string; Message: string }> }>(`${OBJECT_ENDPOINT}/${id}`, body);
        if (!res.Success) {
          const msg = res.Errors?.map(e => `${e.Code}: ${e.Message}`).join(', ') ?? 'Unknown error';
          output.error(`Zuora rejected the product rate plan update.\n  ${msg}`);
          process.exit(1);
        }
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Product rate plan ${id} updated.`);
      })()
    );

  deleteCmd
    .command('product-rate-plan <id>')
    .description('Delete a product rate plan in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${CREATE_ENDPOINT}/${id}`);
        assertSuccess(res, 'product rate plan delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Product rate plan ${id} deleted.`);
      })()
    );
}
