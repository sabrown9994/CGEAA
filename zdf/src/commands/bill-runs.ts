import { Command } from 'commander';
import { apiDelete } from '../api/client.js';
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
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('bill-run <id>')
    .description('Fetch a bill run from Zuora by ID')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Bill run ${id} written to zdf-output/bill-runs/${id}.json`);
      })()
    );

  pushCmd
    .command('bill-run <id>')
    .description('Re-fetch a bill run from Zuora (no PUT endpoint; overwrites local file with latest data)')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Bill run ${id} re-fetched and written to zdf-output/bill-runs/${id}.json`);
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
