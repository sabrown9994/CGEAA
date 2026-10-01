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
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { status: res.status ?? 1, output };
}
