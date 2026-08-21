import inquirer from 'inquirer';
import { output } from './output.js';

export async function confirmProduction(envName: string, opts: { assumeYes: boolean }): Promise<void> {
  if (opts.assumeYes) {
    output.warn(
      `Proceeding against PRODUCTION environment (${envName}) with confirmation assumed (--yes / ZDF_ASSUME_YES).`
    );
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      `Refusing to proceed against PRODUCTION environment (${envName}) without confirmation in a ` +
      `non-interactive session. Pass --yes or set ZDF_ASSUME_YES=true to confirm.`
    );
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `You are about to run this command against a PRODUCTION environment (${envName}). Are you sure?`,
      default: false,
    },
  ]);
  if (!confirmed) throw new Error('Aborted by user.');
}
