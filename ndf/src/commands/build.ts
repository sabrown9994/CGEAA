import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getProjectDir } from '../helpers/project-dir.js';
import { getMergeBase, getChangedFiles } from '../helpers/git.js';
import { generateDeployXml, generateManifestXml, objectIdFromPath } from '../helpers/xml.js';
import { output } from '../helpers/output.js';

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Generate feature-scoped deploy.xml and manifest.xml from git diff vs main')
    .option('--dry-run', 'print generated XML to stdout without writing files')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const projectDir = getProjectDir();
        const mergeBase = getMergeBase(projectDir);
        const { scripts, objects } = getChangedFiles(projectDir, mergeBase);

        if (scripts.length === 0 && objects.length === 0) {
          output.warn('No scripts or objects changed vs main — nothing to build.');
          process.exit(0);
        }

        const deployXml = generateDeployXml(scripts, objects);
        const objectIds = objects.map(objectIdFromPath);
        const manifestXml = generateManifestXml(
          join(projectDir, 'src', 'manifest.xml'), objectIds);

        if (opts.dryRun) {
          console.log('--- deploy.xml (dry run) ---');
          console.log(deployXml);
          console.log('--- manifest.xml (dry run) ---');
          console.log(manifestXml);
          return;
        }

        writeFileSync(join(projectDir, 'src', 'deploy.xml'), deployXml, 'utf-8');
        writeFileSync(join(projectDir, 'src', 'manifest.xml'), manifestXml, 'utf-8');
        output.success(
          'deploy.xml and manifest.xml updated — review and commit them to your feature branch.');
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
