import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPost, apiPut } from '../api/client.js';
import { readResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { checkDeleteAllowed, checkTenantSupported } from '../helpers/delete-guard.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'subscription';
const ENDPOINT = '/v1/subscriptions';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('subscription <id>')
    .description('Fetch a subscription from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull subscription ${id} (see error above).`);
        }
        output.success(`Subscription ${id} written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  createCmd
    .command('subscription <name>')
    .description('Create a subscription [NOT SUPPORTED: Orders is enabled on this tenant — legacy Subscriptions API is disabled]')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/subscriptions/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        checkTenantSupported(RESOURCE, 'create');
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { subscriptionId: string }>(`${ENDPOINT}`, body);
        assertSuccess(res, 'subscription create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.subscriptionId);
        output.success(`Subscription created. Zuora ID: ${res.subscriptionId}`);
      })()
    );

  pushCmd
    .command('subscription <id>')
    .description('Update a subscription in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawBody = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, rawBody);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'subscription update');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Subscription ${id} updated.`);
      })()
    );

  deleteCmd
    .command('subscription <id>')
    .description('Delete a subscription [NOT SUPPORTED: Zuora has no DELETE endpoint for subscriptions — cancel via the Zuora UI or Orders API]')
    .action((_id: string) =>
      runCommand(program, async () => {
        checkDeleteAllowed(RESOURCE);
      })()
    );
}
