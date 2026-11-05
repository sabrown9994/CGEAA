import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { apiGet, apiPost, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { getActiveEnv } from '../auth/config.js';
import { RESOURCE_SUBFOLDERS } from '../constants.js';

const RESOURCE = 'workflow';
const ENDPOINT = '/workflows';

type WorkflowResolution = {
  definitionId: string;
  activeVersionId: string;
  target: { kind: 'active' } | { kind: 'olderVersion'; versionId: string; versionNumber: string };
};

/**
 * Resolve a workflow input ID (which may be either a definition ID or a version ID)
 * to its definition ID, active version ID, and target export parameters.
 *
 * Algorithm:
 * 1. Try treating inputId as a definition ID (GET /workflows/{inputId}/export).
 *    On 200 → it's the definition ID; export returned the active version.
 * 2. On 404 → try treating it as a version ID (GET /workflows/{inputId}).
 *    - Extract definitionId, version, status from the version metadata.
 *    - If status is 'Active' → target is the active version.
 *    - If status is 'Inactive' → target is that specific older version.
 * 3. If neither succeeds → throw a "not found" error with the tenant name.
 */
export async function resolveWorkflow(inputId: string): Promise<WorkflowResolution> {
  // Step 1: Try treating inputId as a definition ID
  try {
    const exportRes = await apiGet<{ workflow?: { id?: number | string; version?: string } }>(`${ENDPOINT}/${inputId}/export`);
    // Success: inputId is a definition ID, export returned the active version
    // FIX 2: Read active version ID directly from export body (workflow.id IS the active version ID)
    const activeVersionId = String(exportRes.workflow?.id ?? '');
    if (!activeVersionId) {
      throw new Error('Workflow export succeeded but returned no workflow.id.');
    }

    output.info(`Resolved workflow: definitionId=${inputId}, activeVersionId=${activeVersionId}, tenant=${getActiveEnv().name}, interpretation=definition`);

    return {
      definitionId: inputId,
      activeVersionId,
      target: { kind: 'active' },
    };
  } catch (err: any) {
    // Not a definition ID; proceed to step 2
  }

  // Step 2: Try treating inputId as a version ID
  try {
    const versionRes = await apiGet<{
      id: number | string;
      definitionId: number | string;
      version: string;
      status: string;
    }>(`${ENDPOINT}/${inputId}`);

    const definitionId = String(versionRes.definitionId);
    const versionNumber = versionRes.version;
    // FIX 3: Case-insensitive status check
    const isActive = String(versionRes.status).toLowerCase() === 'active';

    // Fetch all versions to find the active version ID
    const versionsRes = await apiGet<{ data?: Array<{ id: number | string; status: string }> }>(`${ENDPOINT}/${definitionId}/versions`);
    // FIX 3: Case-insensitive status check
    const activeVersion = (versionsRes.data ?? []).find(v => String(v.status).toLowerCase() === 'active');
    if (!activeVersion) {
      throw new Error(`Workflow ${definitionId} has no active version.`);
    }
    const activeVersionId = String(activeVersion.id);

    if (isActive) {
      output.info(`Resolved workflow: definitionId=${definitionId}, activeVersionId=${activeVersionId}, tenant=${getActiveEnv().name}, interpretation=version (active)`);
      return {
        definitionId,
        activeVersionId,
        target: { kind: 'active' },
      };
    } else {
      output.info(`Resolved workflow: definitionId=${definitionId}, activeVersionId=${activeVersionId}, tenant=${getActiveEnv().name}, interpretation=version (older v${versionNumber})`);
      return {
        definitionId,
        activeVersionId,
        target: { kind: 'olderVersion', versionId: inputId, versionNumber },
      };
    }
  } catch (err: any) {
    // Step 2 also failed - neither interpretation worked
  }

  // Step 3: Neither interpretation worked - throw a clear error
  throw new Error(`No workflow or version found for ID ${inputId} in tenant ${getActiveEnv().name}.`);
}

/**
 * Finds the local file for a workflow definition ID. Filenames are `<name>_<id>.json` (from pull)
 * or `<id>.json` (from create), so this scans the workflows/ folder for:
 * 1. Exact match: `<id>.json`
 * 2. Suffix match: any file ending with `_<id>.json`
 * Returns the full path if exactly one match is found, throws otherwise.
 */
function findLocalFile(id: string): string {
  const dir = join(getOutputDir(), RESOURCE_SUBFOLDERS[RESOURCE]);
  if (!existsSync(dir)) {
    throw new Error(
      `No local file found for workflow ${id} in ${dir}. Run 'cgeaa zuora pull workflow ${id}' first or provide --file <path>.`
    );
  }

  const exactMatch = `${id}.json`;
  const suffix = `_${id}.json`;
  const files = readdirSync(dir);
  const matches = files.filter((f) => f === exactMatch || f.endsWith(suffix));

  if (matches.length === 0) {
    throw new Error(
      `No local file found for workflow ${id} in ${dir}. Run 'cgeaa zuora pull workflow ${id}' first or provide --file <path>.`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple local files match workflow ${id}: ${matches.join(', ')}. Provide --file <path> to disambiguate.`
    );
  }
  return join(dir, matches[0]);
}

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

/**
 * Compute the next workflow version number for a version-import. Zuora requires the new version
 * to be numerically GREATER than every existing version (format `N`, `N.M`, `N.M.P`). We take the
 * highest existing major component and bump it, guaranteeing uniqueness/ordering regardless of the
 * existing scheme. Falls back to `1.0` if the versions list can't be read.
 */
export async function nextWorkflowVersion(id: string): Promise<string> {
  const res = await apiGet<{ data?: Array<{ version?: string }> }>(`${ENDPOINT}/${id}/versions`);
  let maxMajor = 0;
  for (const v of res.data ?? []) {
    const major = parseInt(String(v.version ?? '').split('.')[0], 10);
    if (!Number.isNaN(major) && major > maxMajor) maxMajor = major;
  }
  return `${maxMajor + 1}.0`;
}

type WorkflowSummary = {
  id: number | string;
  name?: string;
  status?: string;
  active_version?: { version?: string };
  [k: string]: unknown;
};

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const listCmd = getOrCreate(program, 'list', 'List resources from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  // Pull the FULL workflow definition via /export ({ workflow_definition, workflow, tasks,
  // linkages }) rather than GET /workflows/{id} (which returns only metadata + active_version).
  // The export shape is the complete, editable representation and is exactly what `create`
  // (POST /workflows/import) consumes — so pull → edit → create is a full-fidelity round-trip.
  // Accepts either a definition ID or a version ID; resolves to the active version unless
  // the supplied ID is explicitly an older, non-active version.
  pullCmd
    .command('workflow <id>')
    .description('Fetch a workflow (full definition, via export) from Zuora by definition or version ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const resolution = await resolveWorkflow(id);

        let data: Record<string, unknown>;
        if (resolution.target.kind === 'active') {
          // Export the active version
          data = await apiGet<Record<string, unknown>>(`${ENDPOINT}/${resolution.definitionId}/export`);
        } else {
          // Export a specific older version
          data = await apiGet<Record<string, unknown>>(
            `${ENDPOINT}/${resolution.definitionId}/export?version=${encodeURIComponent(resolution.target.versionNumber)}`
          );
        }

        assertReadSuccess(data, 'workflow export');
        const { success: _s, ...resource } = data;

        // Extract workflow name from the export
        const workflowName = (resource.workflow_definition as any)?.name ?? (resource.workflow as any)?.name ?? resolution.definitionId;
        const sanitizedName = String(workflowName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${sanitizedName}_${resolution.definitionId}`;

        writeResourceFile(RESOURCE, filename, resource);
        output.success(`Workflow ${resolution.definitionId} written to ${resolveFilePath(RESOURCE, filename)}`);
      })()
    );

  // Create = import a workflow from a local export file. POST /workflows/import takes the export
  // JSON body ({ workflow_definition, workflow, tasks, linkages }) and creates a NEW workflow
  // (new definition id); it returns the created workflow object directly (no {success} envelope).
  createCmd
    .command('workflow <name>')
    .description('Create a workflow in Zuora by importing a local export file (POST /workflows/import)')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/workflows/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<{ id?: number | string; definitionId?: number | string }>(`${ENDPOINT}/import`, body);
        assertReadSuccess(res as Record<string, unknown>, 'workflow import');
        const newId = res.definitionId ?? res.id;
        if (newId === undefined) throw new Error('workflow import succeeded but returned no id/definitionId.');
        if (!opts.file) renameResourceFile(RESOURCE, name, String(newId));
        output.success(`Workflow imported. Zuora definition ID: ${newId}`);
      })()
    );

  // Push applies the edited local definition — settings AND task/linkage logic — to the workflow
  // by importing it as a NEW active version: POST /workflows/{id}/versions/import?version=<next>&
  // activate=true. This is Zuora's supported way to change an existing workflow's logic in place:
  // it creates a new version (numbered above the latest) and makes it active. The body is the
  // /export shape ({ workflow_definition, workflow, tasks, linkages }) written by `pull`. The
  // response is the workflow object directly (no {success} envelope).
  // Accepts either a definition ID or a version ID; resolves to the definition ID.
  pushCmd
    .command('workflow <id>')
    .description('Update a workflow in Zuora from a local file (imports the edited definition as a new active version)')
    .option('-f, --file <path>', 'path to JSON file')
    .option('--version <n>', 'version number for the new version (default: auto-increment above the latest)')
    .option('--no-activate', 'import the new version without making it the active version')
    .action((id: string, opts: { file?: string; version?: string; activate?: boolean }) =>
      runCommand(program, async () => {
        const resolution = await resolveWorkflow(id);
        const definitionId = resolution.definitionId;

        // FIX 1: Use findLocalFile to locate the file by definition ID (finds both <id>.json and <name>_<id>.json)
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : JSON.parse(readFileSync(findLocalFile(definitionId), 'utf-8')) as unknown;
        const version = opts.version ?? (await nextWorkflowVersion(definitionId));
        const activate = opts.activate !== false;
        const res = await apiPost<Record<string, unknown>>(
          `${ENDPOINT}/${definitionId}/versions/import?version=${encodeURIComponent(version)}&activate=${activate}`,
          body
        );
        assertReadSuccess(res, 'workflow version import');
        output.success(
          `Workflow ${definitionId} updated: imported version ${version}${activate ? ' and set it active' : ' (not activated)'}.`
        );
      })()
    );

  listCmd
    .command('workflows')
    .description('List workflows from Zuora')
    .action(() =>
      runCommand(program, async () => {
        const PAGE_LENGTH = 50;
        const MAX_WORKFLOWS = 5000;
        const MAX_PAGES = 200;
        const all: WorkflowSummary[] = [];
        let page = 1;
        let lastTotalCount: number | undefined;

        while (page <= MAX_PAGES) {
          const res = await apiGet<{
            data?: WorkflowSummary[];
            pagination?: { page: number; page_length: number; total_count?: number; next_page?: string | null };
          }>(`${ENDPOINT}?page=${page}&page_length=${PAGE_LENGTH}`);
          assertReadSuccess(res as Record<string, unknown>, 'workflow list fetch');

          const pageData = res.data ?? [];
          if (!Array.isArray(pageData)) {
            throw new Error('Workflow list fetch returned non-array data field.');
          }
          if (pageData.length === 0) break;

          all.push(...pageData);

          // Track the latest total_count for the page-cap warning
          if (res.pagination?.total_count !== undefined) {
            lastTotalCount = res.pagination.total_count;
          }

          // Stop if we've reached the total count (when present)
          if (lastTotalCount !== undefined && all.length >= lastTotalCount) {
            break;
          }

          // Stop if we've hit the safety cap
          if (all.length >= MAX_WORKFLOWS) {
            output.warn(
              `Workflow list: hit the ${MAX_WORKFLOWS}-workflow safety cap before pagination finished; returning ${all.length} workflows collected so far.`
            );
            break;
          }

          page++;
        }

        // Warn if we hit the page cap while more workflows remain
        if (page > MAX_PAGES && (lastTotalCount === undefined || all.length < lastTotalCount)) {
          output.warn(
            `Workflow list: hit the ${MAX_PAGES}-page limit; returning ${all.length} workflows` +
              (lastTotalCount !== undefined ? ` (server indicated ${lastTotalCount} total).` : '.')
          );
        }

        // Print one row per workflow
        for (const w of all) {
          const id = String(w.id);
          const name = String(w.name ?? '');
          const status = String(w.status ?? '');
          const version = w.active_version?.version !== undefined ? `v${String(w.active_version.version)}` : 'v?';
          output.info(`${id}  ${name}  ${status}  ${version}`);
        }

        output.success(`Fetched ${all.length} workflows.`);
      })()
    );

  deleteCmd
    .command('workflow <id>')
    .description('Delete a workflow in Zuora (accepts definition or version ID)')
    .action((id: string) =>
      runCommand(program, async () => {
        const resolution = await resolveWorkflow(id);
        const definitionId = resolution.definitionId;

        // Workflows API DELETE returns a lowercase { success, id } envelope.
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${definitionId}`);
        assertSuccess(res, 'workflow delete');
        output.success(`Workflow ${definitionId} deleted.`);
      })()
    );
}
