import { Command } from 'commander';
import { registerBuild } from './commands/build.js';
import { registerDeploy } from './commands/deploy.js';
import { registerEnvs } from './commands/envs.js';
import { registerSwitch } from './commands/switch-env.js';

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
  return program;
}
