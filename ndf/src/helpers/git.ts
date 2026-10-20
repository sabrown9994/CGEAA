import { execSync } from 'child_process';
import { basename } from 'path';

export interface ChangedFiles {
  scripts: string[];
  objects: string[];
}

const EXCLUDED_FILENAMES = new Set(['.attributes', '.eslintrc.json']);

export function getMergeBase(projectDir: string): string {
  return execSync('git merge-base main HEAD', { cwd: projectDir }).toString().trim();
}

export function getChangedFiles(projectDir: string, mergeBase: string): ChangedFiles {
  if (!/^[0-9a-f]{4,64}$/i.test(mergeBase)) {
    throw new Error(`Invalid merge base SHA: ${mergeBase}`);
  }
  const raw = execSync(`git diff ${mergeBase}..HEAD --name-only --relative`, { cwd: projectDir })
    .toString()
    .trim();
  const files = raw ? raw.split('\n').map((f) => f.trim()).filter(Boolean) : [];

  const scripts = files.filter(
    (f) =>
      f.startsWith('src/FileCabinet/SuiteScripts/') &&
      !f.includes('/node_modules/') &&
      !EXCLUDED_FILENAMES.has(basename(f)),
  );

  const objects = files.filter((f) => f.startsWith('src/Objects/') && f.endsWith('.xml'));

  return { scripts, objects };
}

export function getCurrentBranch(projectDir: string): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir }).toString().trim();
}
