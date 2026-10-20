import { existsSync } from 'fs';
import { join } from 'path';
import { readCgeaaConfig } from './config.js';

export class NdfConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NdfConfigError';
  }
}

export function getProjectDir(): string {
  const config = readCgeaaConfig();
  const dir = config['netsuite_project_dir'];
  if (!dir) {
    throw new NdfConfigError(
      "netsuite_project_dir not configured. Run 'cgeaa netsuite setup' to configure NetSuite.",
    );
  }
  if (!existsSync(join(dir, 'suitecloud.config.js'))) {
    throw new NdfConfigError(
      `netsuite_project_dir '${dir}' does not contain suitecloud.config.js. Run 'cgeaa netsuite setup' to reconfigure.`,
    );
  }
  return dir;
}

export function getProductionAuthId(): string {
  const config = readCgeaaConfig();
  const authId = config['netsuite_production_auth_id'];
  if (!authId) {
    throw new NdfConfigError(
      "netsuite_production_auth_id not configured. Run 'cgeaa netsuite setup' to configure NetSuite.",
    );
  }
  return authId;
}

export function getRunTests(): boolean {
  return readCgeaaConfig()['netsuite_run_tests'] !== 'false';
}
