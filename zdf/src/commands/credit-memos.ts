import { Command } from 'commander';
import { apiPut, apiDelete } from '../api/client.js';
import { readResourceFile } from '../helpers/file-io.js';
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
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('credit-memo <id>')
    .description('Fetch a credit memo from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Credit memo ${id} written to zdf-output/credit-memos/${id}.json`);
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
