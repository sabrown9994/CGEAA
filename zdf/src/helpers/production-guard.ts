import inquirer from 'inquirer';

export async function confirmProduction(isProduction: boolean, envName: string): Promise<void> {
  if (!isProduction) return;
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
