import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { getProjectDir, getProductionAuthId } from '../helpers/project-dir.js';
import { checkProductionGuard } from '../helpers/production-guard.js';
import { runBuild } from '../helpers/build-runner.js';
import { output } from '../helpers/output.js';

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Build and deploy feature changes to the active NetSuite environment')
    .option('--dry-run', 'preview deploy.xml/manifest.xml and run suitecloud --dryrun; writes nothing')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const projectDir = getProjectDir();
        checkProductionGuard(projectDir, getProductionAuthId());
        await runBuild({ projectDir, dryRun: opts.dryRun ?? false });
        const args = ['project:deploy', '--projectdir', projectDir];
        if (opts.dryRun) args.push('--dryrun');
        const result = spawnSync('suitecloud', args, { stdio: 'inherit' });
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
