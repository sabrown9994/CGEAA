import { writeFileSync } from 'fs';
import { join } from 'path';
import { getMergeBase, getChangedFiles } from './git.js';
import { generateDeployXml, generateManifestXml, objectIdFromPath } from './xml.js';
import { runSuitecloud } from './suitecloud.js';
import { output } from './output.js';

export interface BuildOptions {
  projectDir: string;
  dryRun: boolean;
  extraObjectPaths?: string[];
}

export async function runBuild(opts: BuildOptions): Promise<void> {
  const { projectDir, dryRun } = opts;
  const mergeBase = getMergeBase(projectDir);
  const changed = getChangedFiles(projectDir, mergeBase);

  const extra = opts.extraObjectPaths ?? [];
  const objects = [...changed.objects, ...extra.filter((p) => !changed.objects.includes(p))];

  if (changed.scripts.length === 0 && objects.length === 0) {
    output.warn('No scripts or objects changed vs main — nothing to build.');
    process.exit(0);
  }

  const deployXml = generateDeployXml(changed.scripts, objects);
  const objectIds = objects.map(objectIdFromPath);
  const manifestXml = generateManifestXml(join(projectDir, 'src', 'manifest.xml'), objectIds);

  if (dryRun) {
    console.log('--- deploy.xml (dry run) ---');
    console.log(deployXml);
    console.log('--- manifest.xml (dry run) ---');
    console.log(manifestXml);
    return;
  }

  writeFileSync(join(projectDir, 'src', 'deploy.xml'), deployXml, 'utf-8');
  writeFileSync(join(projectDir, 'src', 'manifest.xml'), manifestXml, 'utf-8');

  const dep = runSuitecloud(['project:adddependencies'], { cwd: projectDir });
  if (dep.status !== 0) {
    throw new Error(`project:adddependencies failed:\n${dep.output}`);
  }

  output.success('deploy.xml and manifest.xml updated — review and commit them to your feature branch.');
}
