import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPut } from '../api/client.js';
import { readResourceFile, resolveFilePath } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'product-rate-plan-charge';
const OBJECT_ENDPOINT = '/v1/object/product-rate-plan-charge';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');

  pullCmd
    .command('product-rate-plan-charge <id>')
    .description('Fetch a product rate plan charge from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Product rate plan charge ${id} written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  pushCmd
    .command('product-rate-plan-charge <id>')
    .description('Update a product rate plan charge in Zuora from a local file')
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
          output.error(`Zuora rejected the product rate plan charge update.\n  ${msg}`);
          process.exit(1);
        }
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Product rate plan charge ${id} updated.`);
      })()
    );
}
