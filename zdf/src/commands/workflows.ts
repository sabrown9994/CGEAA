import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
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
 * Build the PUT /workflows/{id} settings body from a pulled workflow file. `pull` writes the
 * `/export` shape ({ workflow_definition, workflow, tasks, linkages }), where settings live in
 * `workflow_definition` (name/description) and the `workflow` version object (snake_case
 * triggers/priority/status/…). PUT expects a flat, camelCase settings object. We remap only the
 * settings PUT accepts; task/linkage edits are NOT applied by push (Zuora has no in-place
 * task-graph update — re-apply those via `create`, which imports a new workflow). Also tolerates
 * a flat/camelCase file (e.g. one saved from GET /workflows/{id}) via the `?? flat` fallbacks.
 */
export function buildWorkflowSettingsBody(file: Record<string, unknown>): Record<string, unknown> {
  const wd = (file['workflow_definition'] as Record<string, unknown> | undefined) ?? {};
  const wv = (file['workflow'] as Record<string, unknown> | undefined) ?? {};
  const pick = (camel: string, snake: string): unknown =>
    file[camel] ?? wv[camel] ?? wv[snake];
  const body: Record<string, unknown> = {
    name: wd['name'] ?? file['name'] ?? wv['name'],
    description: wd['description'] ?? file['description'] ?? wv['description'],
    ondemandTrigger: pick('ondemandTrigger', 'ondemand_trigger'),
    calloutTrigger: pick('calloutTrigger', 'callout_trigger'),
    scheduledTrigger: pick('scheduledTrigger', 'scheduled_trigger'),
    interval: pick('interval', 'interval'),
    timezone: pick('timezone', 'timezone'),
    priority: pick('priority', 'priority'),
    status: pick('status', 'status'),
  };
  // Drop keys we couldn't resolve so we never send `undefined`.
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
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

  // Push updates workflow SETTINGS only (name, description, triggers, priority, status) via
  // PUT /workflows/{id}. Task/linkage changes in the edited file are NOT applied by push —
  // Zuora has no in-place task-graph update; re-apply those by `create`-ing a new workflow from
  // the edited export. PUT returns the updated workflow object directly (no {success} envelope).
  pushCmd
    .command('workflow <id>')
    .description('Update a workflow\'s settings in Zuora from a local file (settings only; not tasks)')
    .option('-f, --file <path>', 'path to JSON file')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawBody = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = buildWorkflowSettingsBody(rawBody);
        const res = await apiPut<Record<string, unknown>>(`${ENDPOINT}/${id}`, body);
        assertReadSuccess(res, 'workflow update');
        output.success(`Workflow ${id} settings updated (task/linkage edits are applied via 'create', not 'push').`);
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
