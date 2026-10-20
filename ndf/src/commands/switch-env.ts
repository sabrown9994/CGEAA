import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getProjectDir, getProductionAuthId } from '../helpers/project-dir.js';
import { ProductionGuardError } from '../helpers/production-guard.js';
import { getCurrentBranch } from '../helpers/git.js';
import { output } from '../helpers/output.js';

export function registerSwitch(program: Command): void {
  program
    .command('switch <authId>')
    .description('Switch the active NetSuite environment (updates project.json defaultAuthId)')
    .action(async (authId: string) => {
      try {
        const projectDir = getProjectDir();
        const productionAuthId = getProductionAuthId();
        if (authId === productionAuthId) {
          const branch = getCurrentBranch(projectDir);
          if (branch !== 'main') {
            throw new ProductionGuardError(branch);
          }
        }
        const projectJsonPath = join(projectDir, 'project.json');
        const current = JSON.parse(readFileSync(projectJsonPath, 'utf-8')) as Record<string, unknown>;
        current['defaultAuthId'] = authId;
        writeFileSync(projectJsonPath, JSON.stringify(current, null, '\t'), 'utf-8');
        output.success(`Switched to environment: ${authId}`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
