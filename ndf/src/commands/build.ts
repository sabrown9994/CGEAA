import { Command } from 'commander';
import { getProjectDir } from '../helpers/project-dir.js';
import { runBuild } from '../helpers/build-runner.js';
import { output } from '../helpers/output.js';

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Generate feature-scoped deploy.xml and manifest.xml from git diff vs main')
    .option('--dry-run', 'print generated XML to stdout without writing files')
    .option('--base <ref>', 'git ref to diff against (default: main)', 'main')
    .action(async (opts: { dryRun?: boolean; base?: string }) => {
      try {
        const projectDir = getProjectDir();
        await runBuild({ projectDir, dryRun: opts.dryRun ?? false, base: opts.base });
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
