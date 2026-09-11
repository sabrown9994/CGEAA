import { Command } from 'commander';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ndf')
    .description('NetSuite Development Framework — cgeaa netsuite commands')
    .version('1.0.0');
  return program;
}
