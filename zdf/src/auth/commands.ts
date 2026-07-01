import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { readConfig, writeConfig, getActiveEnv } from './config.js';
import { ENV_TYPE_TO_BASE_URL, REGION_TO_ENV_TYPES } from '../constants.js';
import { output } from '../helpers/output.js';
import type { ZdfConfig, EnvironmentConfig } from '../types.js';

export function register(program: Command): void {
  const auth = program.command('auth').description('Manage Zuora environments');

  auth
    .command('add')
    .description('Add a new named environment')
    .action(async () => {
      output.info('For a reference of environment types and their base URLs, see: https://developer.zuora.com/v1-api-reference/introduction');

      const { name } = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Environment name:', validate: (v: string) => v.trim() !== '' || 'Name is required' },
      ]);

      const existingConfig = readConfig();
      if (existingConfig?.environments[name as string]) {
        output.warn(`Environment "${name}" already exists and will be overwritten.`);
      }

      const { region } = await inquirer.prompt([
        { type: 'list', name: 'region', message: 'Region:', choices: ['US', 'EU', 'APAC'] },
      ]);

      const { envType } = await inquirer.prompt([
        { type: 'list', name: 'envType', message: 'Environment type:', choices: REGION_TO_ENV_TYPES[region as string] },
      ]);

      const { clientId, clientSecret } = await inquirer.prompt([
        { type: 'input', name: 'clientId', message: 'Client ID:', validate: (v: string) => v.trim() !== '' || 'Required' },
        { type: 'password', name: 'clientSecret', message: 'Client Secret:', mask: '*', validate: (v: string) => v.trim() !== '' || 'Required' },
      ]);

      const baseUrl = ENV_TYPE_TO_BASE_URL[envType as string];
      const isProduction = (envType as string).includes('Production');

      const newEnv: EnvironmentConfig = {
        name: name as string,
        type: envType as string,
        baseUrl,
        isProduction,
        clientId: clientId as string,
        clientSecret: clientSecret as string,
      };

      const existing = readConfig() ?? ({ active: name as string, environments: {} } as ZdfConfig);
      existing.environments[name as string] = newEnv;
      if (!existing.active) existing.active = name as string;
      writeConfig(existing);

      output.success(`Environment "${name}" added.`);
    });

  auth
    .command('list')
    .description('List all configured environments')
    .action(() => {
      const config = readConfig();
      if (!config || Object.keys(config.environments).length === 0) {
        output.warn('No environments configured. Run `zdf auth add` to add one.');
        return;
      }
      for (const [key, env] of Object.entries(config.environments)) {
        const marker = key === config.active ? chalk.bold(' (active)') : '';
        output.info(`${key}${marker} — ${env.type}`);
      }
    });

  auth
    .command('use <name>')
    .description('Switch the active environment')
    .action((name: string) => {
      const config = readConfig();
      if (!config) { output.error('No config found. Run `zdf auth add`.'); process.exit(1); }
      if (!config.environments[name]) { output.error(`Environment "${name}" not found.`); process.exit(1); }
      config.active = name;
      writeConfig(config);
      output.success(`Active environment set to "${name}".`);
    });

  auth
    .command('env')
    .description('Show the currently active environment')
    .action(() => {
      try {
        const env = getActiveEnv();
        output.info(`Active environment: ${env.name} (${env.type})`);
      } catch (e) {
        output.error((e as Error).message);
        process.exit(1);
      }
    });

  auth
    .command('remove <name>')
    .description('Remove a named environment')
    .action((name: string) => {
      const config = readConfig();
      if (!config || !config.environments[name]) { output.error(`Environment "${name}" not found.`); process.exit(1); }
      delete config.environments[name];
      if (config.active === name) {
        const remaining = Object.keys(config.environments);
        if (remaining.length > 0) {
          config.active = remaining[0];
          output.warn(`Active environment switched to "${config.active}".`);
        } else {
          output.warn('No environments remaining. Run `zdf auth add` to add one.');
          config.active = '';
        }
      }
      writeConfig(config);
      output.success(`Environment "${name}" removed.`);
    });
}
