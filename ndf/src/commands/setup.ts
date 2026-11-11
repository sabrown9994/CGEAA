import { Command } from 'commander';
import { createInterface } from 'readline';
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { writeCgeaaConfigKey } from '../helpers/config.js';
import { output } from '../helpers/output.js';

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function listAuthIds(): string[] {
  try {
    const raw = execSync('suitecloud account:manageauth --list').toString();
    return raw
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => l.split('|')[0].trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function detectProjectDir(): string | undefined {
  const candidates = [
    process.cwd(),
    join(process.cwd(), 'NetSuite'),
    join(homedir(), 'Documents', 'FinTech', 'NetSuite'),
    join(homedir(), 'Documents', 'FinSys', 'NetSuite'),
    join(homedir(), 'FinTech', 'NetSuite'),
    join(homedir(), 'FinSys', 'NetSuite'),
  ];
  return candidates.find((c) => existsSync(join(c, 'suitecloud.config.js')));
}

export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function registerSetup(program: Command): void {
  program
    .command('setup')
    .description('Configure cgeaa netsuite for this machine')
    .action(async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        // Step 1: project dir
        const detected = detectProjectDir();
        const promptText = `Enter the absolute path to your SDF project root (containing suitecloud.config.js)${detected ? ` [${detected}]` : ''}: `;
        const dir = await prompt(rl, promptText);
        const raw = dir.trim() || detected || '';
        const chosen = expandTilde(raw);

        if (!chosen) {
          output.error('No project directory provided and none auto-detected. Re-run setup with the absolute path to your SDF project root.');
          process.exit(1);
        }

        if (!existsSync(join(chosen, 'suitecloud.config.js'))) {
          output.error(`suitecloud.config.js not found at ${chosen}. Check the path and re-run setup.`);
          process.exit(1);
        }
        writeCgeaaConfigKey('netsuite_project_dir', chosen);
        output.success(`netsuite_project_dir set to: ${chosen}`);

        // Step 2: show or create auth IDs
        let authIds = listAuthIds();
        if (authIds.length === 0) {
          output.info('No suitecloud auth IDs found. Launching suitecloud account:setup...');
          spawnSync('suitecloud', ['account:setup'], { stdio: 'inherit' });
          authIds = listAuthIds();
          if (authIds.length === 0) {
            output.error('Still no auth IDs configured. Re-run cgeaa netsuite setup when ready.');
            process.exit(1);
          }
        }
        output.info('Configured suitecloud auth IDs:');
        authIds.forEach((id, i) => console.log(`  ${i + 1}. ${id}`));

        // Step 3: pick production
        const prodAnswer = await prompt(rl, 'Which auth ID is production? Enter the exact auth ID: ');
        const prodId = prodAnswer.trim();
        if (!authIds.includes(prodId)) {
          output.error(`"${prodId}" not found. Re-run setup and enter an exact ID from the list.`);
          process.exit(1);
        }
        writeCgeaaConfigKey('netsuite_production_auth_id', prodId);
        output.success(`netsuite_production_auth_id set to: ${prodId}`);
        output.success('NetSuite setup complete. Run "cgeaa netsuite envs" to verify.');
      } finally {
        rl.close();
      }
    });
}
