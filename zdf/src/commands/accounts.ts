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
import { stripEnvMap, setEnvEntry, activeEnvName } from '../helpers/env-map.js';
import { getOrCreate, capturePriorEnvMap, carryForwardEnvMap, carryForwardEnvMapToFile, deleteStaleSourceFile } from '../helpers/upsert-command.js';
import { toAccountCreateBody } from '../helpers/create-shape.js';

const RESOURCE = 'account';
const ENDPOINT = '/v1/accounts';

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
        // Captured BEFORE any mutation — the full accumulated cross-env map (all prior envs),
        // read straight off the in-memory record rather than re-derived from disk, so it can't be
        // lost even if the file's natural key isn't known yet (a new account has no accountNumber
        // until Zuora assigns one).
        const priorMap = capturePriorEnvMap(body as Record<string, unknown> | undefined);
        const res = await apiPost<ZuoraWriteResponse & { accountId: string }>(`${ENDPOINT}`, stripEnvMap(body));
        assertSuccess(res, 'account create');
        if (!opts.file) {
          const fileRecord = body as Record<string, unknown>;
          const key = crossTenantKeyValue(RESOURCE, res as unknown as Record<string, unknown>) ?? crossTenantKeyValue(RESOURCE, fileRecord);
          setEnvEntry(fileRecord, activeEnvName(), { id: res.accountId, key });
          carryForwardEnvMap(fileRecord, priorMap);
          writeResourceFile(RESOURCE, name, fileRecord);
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
        // Captured BEFORE the upsert — the full accumulated cross-env map (all prior envs). Must
        // be carried forward explicitly after resolveAndSync's re-fetch/write: that write starts
        // from a BRAND-NEW record fetched fresh from Zuora, so `mergeExistingEnvMap` inside it can
        // only recover this map for natural-keyed resources (where the natural key is stable
        // across tenants and so resolves to the SAME existing file) — not for id-keyed resources.
        const priorMap = capturePriorEnvMap(fileRecord);
        const target = await resolveTargetId(RESOURCE, fileRecord);

        if (target.found) {
          const basicInfo = fileRecord['basicInfo'] as Record<string, unknown> | undefined;
          if (!basicInfo) {
            throw new Error("Account file is missing 'basicInfo' field. Run 'zdf get account <id>' to refresh it.");
          }
          const body = stripEnvMap(filterUpdatableFields(RESOURCE, basicInfo));
          const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${target.id}`, body);
          assertSuccess(res, 'account update');
          // resolveAndSync's re-fetch is the SOLE writer here (re-fetches + writes _zdf) — no
          // separate explicit write, so there's never a second, divergently-keyed file left
          // behind. carryForwardEnvMapToFile then re-reads that just-written file and folds
          // priorMap back in, guaranteeing no other env's entry is lost.
          await resolveAndSync(RESOURCE, target.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, target.id, priorMap);
          output.success(`Account ${target.id} updated.`);
        } else {
          // A raw pulled body is rejected by POST /v1/accounts (nested read-only fields, ids,
          // status, etc.) — toAccountCreateBody transforms it into the known-good create shape
          // (see zdf/CLAUDE.md "Invoice create / delete" and the account create adapter tests).
          const body = stripEnvMap(toAccountCreateBody(fileRecord));
          const res = await apiPost<ZuoraWriteResponse & { accountId: string }>(`${ENDPOINT}`, body);
          assertSuccess(res, 'account create');
          await resolveAndSync(RESOURCE, res.accountId, 'push');
          carryForwardEnvMapToFile(RESOURCE, res.accountId, priorMap);
          // Account is natural-keyed (accountNumber). If the target tenant assigned a DIFFERENT
          // accountNumber than the source record's, the file resolveAndSync just wrote is named
          // differently from the original arg-keyed source file — delete the now-stale source so a
          // repeat `push <arg>` can't re-read it and duplicate-create. No-op when the names match.
          deleteStaleSourceFile(RESOURCE, id, fileRecord, res.accountId);
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
