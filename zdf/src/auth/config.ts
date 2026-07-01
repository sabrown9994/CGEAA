import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import os from 'os';
import type { ZdfConfig, EnvironmentConfig } from '../types.js';

function configPath(): string {
  return process.env.ZDF_CONFIG_PATH ?? join(os.homedir(), '.zdf', 'config.json');
}

export function readConfig(): ZdfConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ZdfConfig;
  } catch {
    throw new Error(`Config file at ${p} is not valid JSON. Delete it or run \`zdf auth add\` to recreate it.`);
  }
}

export function writeConfig(config: ZdfConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
}

export function getActiveEnv(): EnvironmentConfig {
  const config = readConfig();
  if (!config) throw new Error('No ZDF configuration found. Run `zdf auth add` to get started.');
  const env = config.environments[config.active];
  if (!env) throw new Error(`Active environment "${config.active}" not found in config. Run \`zdf auth list\`.`);
  return env;
}

export function saveUpdatedEnv(env: EnvironmentConfig): void {
  const config = readConfig();
  if (!config) throw new Error('No ZDF configuration found.');
  config.environments[env.name] = env;
  writeConfig(config);
}
