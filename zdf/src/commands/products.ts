import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { writeResourceFile, readResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'product';
const OBJECT_ENDPOINT = '/v1/object/product';
const COMMERCE_ENDPOINT = '/commerce/products';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('product <id>')
    .description('Fetch a product from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull product ${id} (see error above).`);
        }
        output.success(`Product ${id} written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  createCmd
    .command('product <name>')
    .description('Create a product in Zuora from a local file (Commerce API)')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/products/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        // POST /commerce/products returns the product object directly (no {success} envelope)
        const res = await apiPost<{ id: string } & Record<string, unknown>>(`${COMMERCE_ENDPOINT}`, body);
        assertReadSuccess(res as Record<string, unknown>, 'product create');
        if (!res.id) {
          throw new Error('Zuora product create response is missing an id.');
        }
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
        output.success(`Product created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('product <id>')
    .description('Update a product in Zuora from a local file')
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
          output.error(`Zuora rejected the product update.\n  ${msg}`);
          process.exit(1);
        }
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Product ${id} updated.`);
      })()
    );

  deleteCmd
    .command('product <id>')
    .description('Delete a product in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${OBJECT_ENDPOINT}/${id}`);
        assertSuccess(res, 'product delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Product ${id} deleted.`);
      })()
    );
}
