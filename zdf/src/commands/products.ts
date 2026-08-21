import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { writeResourceFile, readResourceFile, renameResourceFile, deleteResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';
import { resolveTargetId, crossTenantKeyValue } from '../helpers/upsert.js';
import { stripEnvMap, setEnvEntry, activeEnvName } from '../helpers/env-map.js';
import { getOrCreate, capturePriorEnvMap, carryForwardEnvMap, carryForwardEnvMapToFile } from '../helpers/upsert-command.js';

const RESOURCE = 'product';
const OBJECT_ENDPOINT = '/v1/object/product';
const COMMERCE_ENDPOINT = '/commerce/products';

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
        output.success(`Product ${id} written to ${getLastPulledPath() ?? resolveFilePath(RESOURCE, id)}`);
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
        // Captured BEFORE any mutation — the full accumulated cross-env map (all prior envs),
        // read straight off the in-memory record. product has no natural key, so a disk-based
        // re-lookup by filename can't recover this later; the in-memory reference is the only
        // reliable source.
        const priorMap = capturePriorEnvMap(body as Record<string, unknown> | undefined);
        // POST /commerce/products returns the product object directly (no {success} envelope)
        const res = await apiPost<{ id: string } & Record<string, unknown>>(`${COMMERCE_ENDPOINT}`, stripEnvMap(body));
        assertReadSuccess(res as Record<string, unknown>, 'product create');
        if (!res.id) {
          throw new Error('Zuora product create response is missing an id.');
        }
        if (!opts.file) {
          const fileRecord = body as Record<string, unknown>;
          const key = crossTenantKeyValue(RESOURCE, res) ?? crossTenantKeyValue(RESOURCE, fileRecord);
          setEnvEntry(fileRecord, activeEnvName(), { id: res.id, key });
          carryForwardEnvMap(fileRecord, priorMap);
          writeResourceFile(RESOURCE, name, fileRecord);
          renameResourceFile(RESOURCE, name, res.id);
        }
        output.success(`Product created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('product <id>')
    .description('Update a product in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        if (opts.file) {
          const rawBody = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
          const body = stripEnvMap(filterUpdatableFields(RESOURCE, rawBody));
          const res = await apiPut<{ Success: boolean; Errors?: Array<{ Code: string; Message: string }> }>(`${OBJECT_ENDPOINT}/${id}`, body);
          if (!res.Success) {
            const msg = res.Errors?.map(e => `${e.Code}: ${e.Message}`).join(', ') ?? 'Unknown error';
            output.error(`Zuora rejected the product update.\n  ${msg}`);
            process.exit(1);
          }
          await resolveAndSync(RESOURCE, id, 'push');
          output.success(`Product ${id} updated.`);
          return;
        }

        const fileRecord = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        // Captured BEFORE the upsert — the full accumulated cross-env map (all prior envs).
        // product has no natural key, so once the old arg-keyed file is deleted below, its
        // _zdf map is unrecoverable from disk — this in-memory reference is the ONLY way the
        // other envs' entries survive onto the new target.id-keyed file.
        const priorMap = capturePriorEnvMap(fileRecord);
        const target = await resolveTargetId(RESOURCE, fileRecord);

        if (target.found) {
          const body = stripEnvMap(filterUpdatableFields(RESOURCE, fileRecord));
          const res = await apiPut<{ Success: boolean; Errors?: Array<{ Code: string; Message: string }> }>(`${OBJECT_ENDPOINT}/${target.id}`, body);
          if (!res.Success) {
            const msg = res.Errors?.map(e => `${e.Code}: ${e.Message}`).join(', ') ?? 'Unknown error';
            output.error(`Zuora rejected the product update.\n  ${msg}`);
            process.exit(1);
          }
          // resolveAndSync's re-fetch is the SOLE writer here. product has NO natural-key
          // filename (fileNameFor falls back to the id argument), so writing explicitly under
          // the CLI arg `id` here AND letting resolveAndSync write again under `target.id` would
          // leave TWO divergent files whenever the resolved id differs from the arg (the
          // cross-tenant case) — a stale `<id>.json` and a fresh `<target.id>.json`, with no
          // findByStoredId fallback to reconcile them on a later `push product <id>`. One write,
          // keyed by the resolved id, avoids that split entirely.
          await resolveAndSync(RESOURCE, target.id, 'push');
          // Fold priorMap (captured above) back onto the file resolveAndSync just wrote, BEFORE
          // deleting the old arg-keyed file — so the merged map is confirmed on disk under
          // target.id first, and the delete below never destroys the only copy of it.
          carryForwardEnvMapToFile(RESOURCE, target.id, priorMap);
          // product is id-named (no natural key) — if the resolved id differs from the CLI arg
          // (the cross-tenant case), the arg-keyed file is now stale (superseded by the
          // target.id-keyed file above, which already carries priorMap forward); remove it so a
          // later `push product <id>` can't find and re-push it.
          if (target.id !== id) deleteResourceFile(RESOURCE, id);
          output.success(`Product ${target.id} updated.`);
        } else {
          const body = stripEnvMap(fileRecord);
          const res = await apiPost<{ id: string } & Record<string, unknown>>(`${COMMERCE_ENDPOINT}`, body);
          assertReadSuccess(res as Record<string, unknown>, 'product create');
          if (!res.id) {
            throw new Error('Zuora product create response is missing an id.');
          }
          // Same single-writer rule as the found branch: re-fetch/write by the CREATED id rather
          // than writing the local (pre-create) body under the CLI arg.
          await resolveAndSync(RESOURCE, res.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, res.id, priorMap);
          if (res.id !== id) deleteResourceFile(RESOURCE, id);
          output.success(`Product created. Zuora ID: ${res.id}`);
        }
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
