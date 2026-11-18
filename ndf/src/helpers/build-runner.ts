import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getMergeBase, getChangedFiles, getCurrentBranch } from './git.js';
import { generateDeployXml, generateManifestXml, objectIdFromPath, stripSelfProvidedDeps } from './xml.js';
import { runSuitecloud } from './suitecloud.js';
import { output } from './output.js';

export interface BuildOptions {
  projectDir: string;
  dryRun: boolean;
  extraObjectPaths?: string[];
  base?: string;
}

export interface BuildResult {
  /** The feature's changed SuiteScript paths (project-relative, `src/...`), from base..HEAD. */
  changedScripts: string[];
}

export function warnIfSharedBranch(projectDir: string, base?: string): void {
  const SHARED_BRANCHES = new Set(['main', 'master', 'qa', 'uat', 'staging']);
  const currentBranch = getCurrentBranch(projectDir);
  if (SHARED_BRANCHES.has(currentBranch) && (base ?? 'main') === 'main') {
    output.warn(`Running from shared branch '${currentBranch}' with the default base 'main' — the diff scope may be empty (on main) or over-broad (on a long-lived env branch). Run from a feature branch, or pass --base <ref> to scope deliberately.`);
  }
}

export async function runBuild(opts: BuildOptions): Promise<BuildResult> {
  const { projectDir, dryRun } = opts;
  const mergeBase = getMergeBase(projectDir, opts.base ?? 'main');
  const changed = getChangedFiles(projectDir, mergeBase);

  const extra = opts.extraObjectPaths ?? [];
  const objects = [...changed.objects, ...extra.filter((p) => !changed.objects.includes(p))];

  if (changed.scripts.length === 0 && objects.length === 0) {
    output.warn(`No scripts or objects changed vs ${opts.base ?? 'main'} — nothing to build.`);
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
    return { changedScripts: changed.scripts };
  }

  writeFileSync(join(projectDir, 'src', 'deploy.xml'), deployXml, 'utf-8');
  writeFileSync(join(projectDir, 'src', 'manifest.xml'), manifestXml, 'utf-8');

  const dep = runSuitecloud(['project:adddependencies'], { cwd: projectDir });
  if (dep.status !== 0) {
    throw new Error(`project:adddependencies failed:\n${dep.output}`);
  }

  // adddependencies re-lists the objects we are SHIPPING under <dependencies><objects>, which fails
  // account validation on any target that doesn't have them yet (first-time deploy / prod cutover):
  // "manifest contains a dependency on <id>, but it is not in the account". Strip the self-provided
  // ids — they ship in this deploy, not external deps. Genuine external deps stay. (FINT-17163)
  const manifestPath = join(projectDir, 'src', 'manifest.xml');
  const stripped = stripSelfProvidedDeps(readFileSync(manifestPath, 'utf-8'), objectIds);
  writeFileSync(manifestPath, stripped, 'utf-8');

  output.success('deploy.xml and manifest.xml updated — review and commit them to your feature branch.');
  return { changedScripts: changed.scripts };
}
