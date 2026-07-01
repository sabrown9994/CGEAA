import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Override config path for tests
process.env.ZDF_CONFIG_PATH = join(os.tmpdir(), `zdf-test-${Date.now()}`, 'config.json');

import { readConfig, writeConfig, getActiveEnv, saveUpdatedEnv } from '../../auth/config.js';
import type { ZdfConfig } from '../../types.js';

const testConfig: ZdfConfig = {
  active: 'sandbox',
  environments: {
    sandbox: {
      name: 'sandbox',
      type: 'US API Sandbox (Cloud 2)',
      baseUrl: 'https://rest.apisandbox.zuora.com',
      isProduction: false,
      clientId: 'cid',
      clientSecret: 'csec',
    },
  },
};

afterEach(() => {
  const dir = join(process.env.ZDF_CONFIG_PATH!, '..');
  if (existsSync(dir)) rmSync(dir, { recursive: true });
});

describe('readConfig', () => {
  it('returns null when config file does not exist', () => {
    expect(readConfig()).toBeNull();
  });
});

describe('writeConfig / readConfig', () => {
  it('round-trips a config object', () => {
    writeConfig(testConfig);
    const result = readConfig();
    expect(result).toEqual(testConfig);
  });
});

describe('getActiveEnv', () => {
  it('returns the active environment config', () => {
    writeConfig(testConfig);
    const env = getActiveEnv();
    expect(env.name).toBe('sandbox');
    expect(env.isProduction).toBe(false);
  });

  it('throws when no config exists', () => {
    expect(() => getActiveEnv()).toThrow('No ZDF configuration found');
  });
});

describe('saveUpdatedEnv', () => {
  it('updates an existing environment in the config', () => {
    writeConfig(testConfig);
    const updated = { ...testConfig.environments.sandbox, clientId: 'new-cid' };
    saveUpdatedEnv(updated);
    const result = readConfig();
    expect(result?.environments.sandbox.clientId).toBe('new-cid');
  });

  it('throws when no config exists', () => {
    expect(() => saveUpdatedEnv(testConfig.environments.sandbox)).toThrow('No ZDF configuration found');
  });
});
