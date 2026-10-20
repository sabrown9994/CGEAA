import { Command } from 'commander';
import { execSync } from 'child_process';
import { getProjectDir, getProductionAuthId } from '../helpers/project-dir.js';
import { getActiveAuthId } from '../helpers/production-guard.js';
import { output } from '../helpers/output.js';

function parseAuthIds(raw: string): string[] {
  // Strip ANSI escape codes, extract first pipe-delimited field per line
  return raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split('|')[0].trim()).filter(Boolean);
}

export function registerEnvs(program: Command): void {
  program.command('envs').description('List configured NetSuite environments').action(async () => {
    try {
      const projectDir = getProjectDir();
      const productionAuthId = getProductionAuthId();
      const activeAuthId = getActiveAuthId(projectDir);
      const raw = execSync('suitecloud account:manageauth --list', { cwd: projectDir }).toString();
      for (const id of parseAuthIds(raw)) {
        const marker = id === activeAuthId ? '*' : ' ';
        const prod = id === productionAuthId ? '  [PROD]' : '';
        console.log(`${marker} ${id}${prod}`);
      }
    } catch (err) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
}
