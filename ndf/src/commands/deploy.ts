import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { getProjectDir, getProductionAuthId, getRunTests } from '../helpers/project-dir.js';
import { checkProductionGuard } from '../helpers/production-guard.js';
import { runBuild } from '../helpers/build-runner.js';
import { output } from '../helpers/output.js';

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Build and deploy feature changes to the active NetSuite environment')
    .option('--dry-run', 'preview deploy.xml/manifest.xml and run suitecloud --dryrun; writes nothing')
    .option('--skip-tests', 'skip SuiteCloud Jest tests for this deploy')
    .action(async (opts: { dryRun?: boolean; skipTests?: boolean }) => {
      try {
        const projectDir = getProjectDir();
        checkProductionGuard(projectDir, getProductionAuthId());
        await runBuild({ projectDir, dryRun: opts.dryRun ?? false });
        const skipTests = opts.skipTests || getRunTests() === false;
        if (skipTests) {
          output.info('Skipping SuiteCloud Jest tests for this deploy (NDF_SKIP_TESTS=true).');
        }
        const args = ['project:deploy'];
        if (opts.dryRun) args.push('--dryrun');
        const env = skipTests ? { ...process.env, NDF_SKIP_TESTS: 'true' } : process.env;
        const result = spawnSync('suitecloud', args, { stdio: 'inherit', cwd: projectDir, env });
        if (result.status !== 0) {
          output.error(`suitecloud project:deploy exited with code ${result.status ?? 'unknown'}.`);
          process.exit(1);
        }
        output.success('Deploy complete.');
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
