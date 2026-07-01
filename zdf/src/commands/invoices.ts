import { Command } from 'commander';
import { apiGet, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'invoice';
const ENDPOINT = '/v1/invoices';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('invoice <id>')
    .description('Fetch an invoice from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Invoice ${id} written to zdf-output/invoices/${id}.json`);
      })()
    );

  pushCmd
    .command('invoice <id>')
    .description('Update an invoice in Zuora from a local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, fileData);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'invoice push');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Invoice ${id} updated.`);
      })()
    );

  deleteCmd
    .command('invoice <id>')
    .description('Delete an invoice in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse & { jobId?: string }>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'invoice delete');
        if (res.jobId) {
          output.info(`Async delete started. Job ID: ${res.jobId}. Polling for completion...`);
          await pollAsyncJob(res.jobId);
        }
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Invoice ${id} deleted.`);
      })()
    );
}

async function pollAsyncJob(jobId: string): Promise<void> {
  const POLL_INTERVAL_MS = 2000;
  const MAX_ATTEMPTS = 30;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const job = await apiGet<{ jobStatus: string }>(`/v1/async-jobs/${jobId}`);
    if (job.jobStatus === 'Completed') return;
    if (job.jobStatus === 'Failed') throw new Error(`Async delete job ${jobId} failed.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Async delete job ${jobId} timed out after ${MAX_ATTEMPTS} attempts.`);
}
