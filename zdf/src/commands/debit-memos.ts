import { Command } from 'commander';
import { apiPut, apiDelete } from '../api/client.js';
import { readResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'debit-memo';
const ENDPOINT = '/v1/debit-memos';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('debit-memo <id>')
    .description('Fetch a debit memo from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Debit memo ${id} written to zdf-output/debit-memos/${id}.json`);
      })()
    );

  pushCmd
    .command('debit-memo <id>')
    .description('Update a debit memo in Zuora from a local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, fileData);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'debit-memo push');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Debit memo ${id} updated.`);
      })()
    );

  deleteCmd
    .command('debit-memo <id>')
    .description('Delete a debit memo in Zuora (must be Canceled status)')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'debit-memo delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Debit memo ${id} deleted.`);
      })()
    );
}
