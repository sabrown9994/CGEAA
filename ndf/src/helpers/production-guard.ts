import { readFileSync } from 'fs';
import { join } from 'path';
import { getCurrentBranch } from './git.js';

export class ProductionGuardError extends Error {
  constructor(branch: string) {
    super(
      `Cannot deploy/switch to production outside of main.\n` +
        `Current branch: ${branch}. Merge your changes to main first.`);
    this.name = 'ProductionGuardError';
  }
}

export function getActiveAuthId(projectDir: string): string {
  const raw = readFileSync(join(projectDir, 'project.json'), 'utf-8');
  return (JSON.parse(raw) as { defaultAuthId?: string }).defaultAuthId ?? '';
}

export function checkProductionGuard(projectDir: string, productionAuthId: string): void {
  if (getActiveAuthId(projectDir) !== productionAuthId) return;
  const branch = getCurrentBranch(projectDir);
  if (branch !== 'main') throw new ProductionGuardError(branch);
}
