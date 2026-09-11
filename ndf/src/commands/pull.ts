import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { getProjectDir } from '../helpers/project-dir.js';
import { output } from '../helpers/output.js';

function runSuitecloud(args: string[]): void {
  const result = spawnSync('suitecloud', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`suitecloud exited with code ${result.status ?? 'unknown'}.`);
  }
}

export function registerPull(program: Command): void {
  const pullCmd = program.command('pull').description('Import scripts or objects from NetSuite');

  pullCmd
    .command('object <scriptId>')
    .description('Import a custom object from NetSuite into src/Objects/')
    .action(async (scriptId: string) => {
      try {
        const projectDir = getProjectDir();
        runSuitecloud([
          'object:import',
          '--scriptid', scriptId,
          '--projectdir', projectDir,
          '--type', 'ALL',
          '--destinationfolder', '/Objects',
        ]);
        output.success(`Object ${scriptId} imported.`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  pullCmd
    .command('file <path>')
    .description('Import a file from the NetSuite File Cabinet')
    .action(async (filePath: string) => {
      try {
        const projectDir = getProjectDir();
        runSuitecloud([
          'file:import',
          '--paths', filePath,
          '--projectdir', projectDir,
        ]);
        output.success(`File ${filePath} imported.`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
