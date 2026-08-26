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
    throw new Error(`Config file at ${p} is not valid JSON. Delete it or run \`cgeaa zuora auth add\` to recreate it.`);
  }
}

export function writeConfig(config: ZdfConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Returns the active environment config. In CI/CD contexts the full config
 * file can be bypassed by setting three env vars instead:
 *   ZDF_CLIENT_ID      — OAuth client ID
 *   ZDF_CLIENT_SECRET  — OAuth client secret
 *   ZDF_BASE_URL       — Zuora REST base URL (e.g. https://rest.zuora.com)
 * When all three are present they take precedence over any config file.
 * Optional: ZDF_ENV_NAME sets the environment name label (default "ci").
 * Optional: ZDF_IS_PRODUCTION=true marks the env as production. Production WRITES
 *   (create/push/delete) are then subject to the write policy in command-policy.ts:
 *   financial-resource writes are blocked unless ZDF_ALLOW_PROD_FINANCIAL=true; all
 *   other production writes require confirmation, satisfied by ZDF_ASSUME_YES=true
 *   (or an interactive TTY prompt) — set ZDF_IS_PRODUCTION=false in automated pipelines
 *   that should never be gated.
 */
export function getActiveEnv(): EnvironmentConfig {
  const clientId = process.env.ZDF_CLIENT_ID;
  const clientSecret = process.env.ZDF_CLIENT_SECRET;
  const baseUrl = process.env.ZDF_BASE_URL;
  if (clientId && clientSecret && baseUrl) {
    return {
      name: process.env.ZDF_ENV_NAME ?? 'ci',
      type: 'CI',
      baseUrl,
      isProduction: process.env.ZDF_IS_PRODUCTION === 'true',
      clientId,
      clientSecret,
      fromEnv: true,
    };
  }
  const config = readConfig();
  if (!config) throw new Error('No ZDF configuration found. Run `cgeaa zuora auth add` to get started, or set ZDF_CLIENT_ID, ZDF_CLIENT_SECRET, and ZDF_BASE_URL environment variables.');
  const env = config.environments[config.active];
  if (!env) throw new Error(`Active environment "${config.active}" not found in config. Run \`cgeaa zuora auth list\`.`);
  return env;
}

export function saveUpdatedEnv(env: EnvironmentConfig): void {
  const config = readConfig();
  if (!config) throw new Error('No ZDF configuration found.');
  config.environments[env.name] = env;
  writeConfig(config);
}
