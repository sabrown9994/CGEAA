import { Command } from 'commander';
import { registerBuild } from './commands/build.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ndf')
    .description('NetSuite Development Framework — cgeaa netsuite commands')
    .version('1.0.0');
  registerBuild(program);
  return program;
}
