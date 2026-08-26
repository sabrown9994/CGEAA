import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';

const RESOURCE = 'workflow';
const ENDPOINT = '/workflows';

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

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  // Pull the FULL workflow definition via /export ({ workflow_definition, workflow, tasks,
  // linkages }) rather than GET /workflows/{id} (which returns only metadata + active_version).
  // The export shape is the complete, editable representation and is exactly what `create`
  // (POST /workflows/import) consumes — so pull → edit → create is a full-fidelity round-trip.
  pullCmd
    .command('workflow <id>')
    .description('Fetch a workflow (full definition, via export) from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const data = await apiGet<Record<string, unknown>>(`${ENDPOINT}/${id}/export`);
        assertReadSuccess(data, 'workflow export');
        const { success: _s, ...resource } = data;
        writeResourceFile(RESOURCE, id, resource);
        output.success(`Workflow ${id} written to ${resolveFilePath(RESOURCE, id)}`);
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
  pushCmd
    .command('workflow <id>')
    .description('Update a workflow in Zuora from a local file (imports the edited definition as a new active version)')
    .option('-f, --file <path>', 'path to JSON file')
    .option('--version <n>', 'version number for the new version (default: auto-increment above the latest)')
    .option('--no-activate', 'import the new version without making it the active version')
    .action((id: string, opts: { file?: string; version?: string; activate?: boolean }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, id);
        const version = opts.version ?? (await nextWorkflowVersion(id));
        const activate = opts.activate !== false;
        const res = await apiPost<Record<string, unknown>>(
          `${ENDPOINT}/${id}/versions/import?version=${encodeURIComponent(version)}&activate=${activate}`,
          body
        );
        assertReadSuccess(res, 'workflow version import');
        output.success(
          `Workflow ${id} updated: imported version ${version}${activate ? ' and set it active' : ' (not activated)'}.`
        );
      })()
    );

  deleteCmd
    .command('workflow <id>')
    .description('Delete a workflow in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        // Workflows API DELETE returns a lowercase { success, id } envelope.
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'workflow delete');
        output.success(`Workflow ${id} deleted.`);
      })()
    );
}
