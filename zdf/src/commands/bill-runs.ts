import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPost, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'bill-run';
const ENDPOINT = '/v1/bill-runs';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('bill-run <id>')
    .description('Fetch a bill run from Zuora by ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull bill-run ${id} (see error above).`);
        }
        output.success(`Bill run ${id} written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  createCmd
    .command('bill-run <name>')
    .description('Create a bill run in Zuora from a local file (WARNING: executes real billing)')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/bill-runs/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        output.warn(
          'Creating a bill run EXECUTES BILLING in the target tenant: it generates real invoices ' +
          'and/or credit memos for the accounts/subscriptions in scope. This is not a dry run.'
        );
        const res = await apiPost<ZuoraWriteResponse & { id: string; billRunNumber?: string }>(ENDPOINT, body);
        assertSuccess(res, 'bill-run create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.id);
        output.success(`Bill run created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('bill-run <id>')
    .description('Re-fetch a bill run from Zuora (no PUT endpoint; overwrites local file with latest data)')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to re-fetch bill-run ${id} (see error above).`);
        }
        output.success(`Bill run ${id} re-fetched and written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  deleteCmd
    .command('bill-run <id>')
    .description('Delete a bill run in Zuora (must be Canceled or Error status)')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'bill-run delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Bill run ${id} deleted.`);
      })()
    );
}
