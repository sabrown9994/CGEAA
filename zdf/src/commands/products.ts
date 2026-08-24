import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { writeResourceFile, readResourceFile, readResourceFileByIdOrName, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getLastPulledPath } from '../helpers/dependency-graph.js';
import { resolveTargetId, crossTenantKeyValue } from '../helpers/upsert.js';
import { stripEnvMap, setEnvEntry, getEnvEntry, activeEnvName } from '../helpers/env-map.js';
import { getOrCreate, capturePriorEnvMap, carryForwardEnvMap, carryForwardEnvMapToFile, deleteStaleSourceFile } from '../helpers/upsert-command.js';

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
        // read straight off the in-memory record. At create time the record has no assigned SKU
        // yet (Zuora may assign one), so a disk-based re-lookup by natural key can't recover this
        // later; the in-memory reference is the only reliable source.
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
        // Captured BEFORE the upsert — the full accumulated cross-env map (all prior envs). On
        // the create (not-found) branch below, a stale source file keyed by an OLD SKU may get
        // deleted once the new record's map is confirmed elsewhere on disk — this in-memory
        // reference is the ONLY way the other envs' entries reliably survive that.
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
          // resolveAndSync's re-fetch is the SOLE writer here (re-fetches + writes _zdf) — see
          // accounts.ts push for why a separate explicit write would risk a divergently-keyed
          // file. product is now SKU-named (natural key) like account/invoice: SKU doesn't change
          // on an update, so the file resolveAndSync writes lands under the SAME SKU-derived
          // filename the source was already read from — no stale-file cleanup needed here (unlike
          // the create branch below, where the target tenant assigns a NEW record and its SKU
          // could differ from the source's).
          await resolveAndSync(RESOURCE, target.id, 'push');
          carryForwardEnvMapToFile(RESOURCE, target.id, priorMap);
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
          // product is natural-keyed (SKU). If the target tenant's create didn't preserve the
          // source's SKU, the file resolveAndSync just wrote is named differently from the
          // original arg-keyed source file — delete the now-stale source so a repeat `push <arg>`
          // can't re-read it (still unmapped, still keyed by the OLD SKU) and duplicate-create.
          // No-op (via fileNameFor comparison, not raw id equality) when the names match — see
          // upsert-command.ts deleteStaleSourceFile.
          deleteStaleSourceFile(RESOURCE, id, fileRecord, res.id);
          output.success(`Product created. Zuora ID: ${res.id}`);
        }
      })()
    );

  deleteCmd
    .command('product <id>')
    .description('Delete a product in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        // product is now SKU-named on disk, but the legacy object endpoint's DELETE requires the
        // internal Zuora id — it does not accept the SKU. Resolve the real id from the local file
        // (exact SKU-named file, or an id-scan fallback via readResourceFileByIdOrName) before
        // issuing the DELETE: prefer the active env's mapped id (_zdf[env].id), then the record's
        // own Id/id. If no local file exists (or it has no resolvable id), fall back to treating
        // the CLI arg as the id directly — back-compat for `delete product <internalId>`.
        const existing = readResourceFileByIdOrName(RESOURCE, id) as Record<string, unknown> | undefined;
        let resolvedId = id;
        if (existing) {
          const envEntry = getEnvEntry(existing, activeEnvName());
          resolvedId = envEntry?.id
            ?? (existing['Id'] as string | undefined)
            ?? (existing['id'] as string | undefined)
            ?? id;
        }
        const res = await apiDelete<ZuoraWriteResponse>(`${OBJECT_ENDPOINT}/${resolvedId}`);
        assertSuccess(res, 'product delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Product ${id} deleted.`);
      })()
    );
}
