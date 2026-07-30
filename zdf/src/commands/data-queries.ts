import { Command } from 'commander';
import { readFileSync } from 'fs';
import ora from 'ora';
import { apiGet, apiPost, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';

const RESOURCE = 'data-query';
const ENDPOINT = '/query/jobs';

const POLL_INTERVAL_MS = 3000;

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

async function pollUntilComplete(jobId: string): Promise<Record<string, unknown>> {
  const spinner = ora(`Waiting for data query job ${jobId} to complete…`).start();
  try {
    while (true) {
      const job = await apiGet<Record<string, unknown>>(`${ENDPOINT}/${jobId}`);
      const status = job['queryStatus'];
      if (typeof status !== 'string') throw new Error(`Unexpected queryStatus value: ${JSON.stringify(status)}`);
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        spinner.stop();
        return job;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } catch (e) {
    spinner.fail('Data query job polling failed.');
    throw e;
  }
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('data-query <id>')
    .description('Fetch a data query job status from Zuora by job ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const data = await apiGet<Record<string, unknown>>(`${ENDPOINT}/${id}`);
        assertReadSuccess(data, 'data query job fetch');
        writeResourceFile(RESOURCE, id, data);
        output.success(`Data query job ${id} written to ${resolveFilePath(RESOURCE, id)}`);
      })()
    );

  createCmd
    .command('data-query <name>')
    .description('Submit a data query job to Zuora from a local .sql file')
    .option('-f, --file <path>', `path to SQL file (defaults to ${getOutputDir()}/data-queries/<name>.sql)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const sql: string = opts.file
          ? readFileSync(opts.file, 'utf-8')
          : (readResourceFile(RESOURCE, name, 'sql') as string);
        const res = await apiPost<{ id: string }>(`${ENDPOINT}`, { queryString: sql });
        const jobId = res.id;
        const job = await pollUntilComplete(jobId);
        if (job['queryStatus'] !== 'completed') {
          throw new Error(`Data query job ${jobId} ended with status: ${String(job['queryStatus'])}`);
        }
        writeResourceFile(RESOURCE, jobId, job);
        output.success(`Data query job ${jobId} completed and written to ${resolveFilePath(RESOURCE, jobId)}`);
      })()
    );

  deleteCmd
    .command('data-query <id>')
    .description('Cancel/delete a data query job in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'data query delete');
        output.success(`Data query job ${id} deleted.`);
      })()
    );
}
