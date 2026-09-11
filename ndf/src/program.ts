import { Command } from 'commander';
import { registerBuild } from './commands/build.js';
import { registerDeploy } from './commands/deploy.js';
import { registerEnvs } from './commands/envs.js';
import { registerSwitch } from './commands/switch-env.js';
import { registerPull } from './commands/pull.js';
import { registerSetup } from './commands/setup.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ndf')
    .description('NetSuite Development Framework — cgeaa netsuite commands')
    .version('1.0.0');
  registerBuild(program);
  registerDeploy(program);
  registerEnvs(program);
  registerSwitch(program);
  registerPull(program);
  registerSetup(program);
  return program;
}
