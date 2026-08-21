import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';
import { resolveTargetId, crossTenantKeyValue } from '../helpers/upsert.js';
import { stripEnvMap, setEnvEntry, activeEnvName, mergeExistingEnvMap } from '../helpers/env-map.js';

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
        const fetched = await resolveAndSync(RESOURCE, id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull account ${id} (see error above).`);
        }
        output.success(`Account ${id} written to ${getLastPulledPath() ?? resolveFilePath(RESOURCE, id)}`);
      })()
    );

  createCmd
    .command('account <name>')
    .description('Create an account in Zuora from a local file')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/accounts/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { accountId: string }>(`${ENDPOINT}`, stripEnvMap(body));
        assertSuccess(res, 'account create');
        if (!opts.file) {
          const fileRecord = body as Record<string, unknown>;
          const key = crossTenantKeyValue(RESOURCE, res as unknown as Record<string, unknown>) ?? crossTenantKeyValue(RESOURCE, fileRecord);
          const withActive = setEnvEntry(fileRecord, activeEnvName(), { id: res.accountId, key });
          const withMap = mergeExistingEnvMap(RESOURCE, name, withActive);
          writeResourceFile(RESOURCE, name, withMap);
          renameResourceFile(RESOURCE, name, res.accountId);
        }
        output.success(`Account created. Zuora ID: ${res.accountId}`);
      })()
    );

  pushCmd
    .command('account <id>')
    .description('Update an account in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        if (opts.file) {
          const body = JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown;
          const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, stripEnvMap(body));
          assertSuccess(res, 'account update');
          await resolveAndSync(RESOURCE, id, 'push');
          output.success(`Account ${id} updated.`);
          return;
        }

        const fileRecord = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const target = await resolveTargetId(RESOURCE, fileRecord);

        if (target.found) {
          const basicInfo = fileRecord['basicInfo'] as Record<string, unknown> | undefined;
          if (!basicInfo) {
            throw new Error("Account file is missing 'basicInfo' field. Run 'zdf get account <id>' to refresh it.");
          }
          const body = stripEnvMap(filterUpdatableFields(RESOURCE, basicInfo));
          const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${target.id}`, body);
          assertSuccess(res, 'account update');
          // resolveAndSync's re-fetch is the SOLE writer here (re-fetches + writes _zdf, merged
          // with any other envs already on the file) — no separate explicit write, so there's
          // never a second, divergently-keyed file left behind.
          await resolveAndSync(RESOURCE, target.id, 'push');
          output.success(`Account ${target.id} updated.`);
        } else {
          const body = stripEnvMap(fileRecord);
          const res = await apiPost<ZuoraWriteResponse & { accountId: string }>(`${ENDPOINT}`, body);
          assertSuccess(res, 'account create');
          await resolveAndSync(RESOURCE, res.accountId, 'push');
          output.success(`Account created. Zuora ID: ${res.accountId}`);
        }
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
