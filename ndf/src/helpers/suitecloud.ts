import { spawnSync } from 'child_process';

export interface SuitecloudResult {
  status: number;
  output: string;
}

export function runSuitecloud(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): SuitecloudResult {
  const res = spawnSync('suitecloud', args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf-8',
  });
  const errorMsg = res.error ? `Error: ${res.error.message}\n` : '';
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}${errorMsg}`;
  return { status: res.status ?? 1, output };
}
