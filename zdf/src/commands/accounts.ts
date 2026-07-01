import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, renameResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'account';
const ENDPOINT = '/v1/accounts';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('account <id>')
    .description('Fetch an account from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Account ${id} written to zdf-output/accounts/${id}.json`);
      })()
    );

  createCmd
    .command('account <name>')
    .description('Create an account in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file (defaults to zdf-output/accounts/<name>.json)')
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { accountId: string }>(`${ENDPOINT}`, body);
        assertSuccess(res, 'account create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.accountId);
        output.success(`Account created. Zuora ID: ${res.accountId}`);
      })()
    );

  pushCmd
    .command('account <id>')
    .description('Update an account in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        let body: unknown;
        if (opts.file) {
          body = JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown;
        } else {
          const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
          const basicInfo = fileData['basicInfo'] as Record<string, unknown> | undefined;
          if (!basicInfo) {
            throw new Error("Account file is missing 'basicInfo' field. Run 'zdf get account <id>' to refresh it.");
          }
          body = filterUpdatableFields(RESOURCE, basicInfo);
        }
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'account update');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Account ${id} updated.`);
      })()
    );

  deleteCmd
    .command('account <id>')
    .description('Delete an account in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'account delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Account ${id} deleted.`);
      })()
    );
}
