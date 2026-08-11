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

  it('returns env-var credentials when ZDF_CLIENT_ID/SECRET/BASE_URL are all set', () => {
    process.env.ZDF_CLIENT_ID = 'ci-client-id';
    process.env.ZDF_CLIENT_SECRET = 'ci-client-secret';
    process.env.ZDF_BASE_URL = 'https://rest.zuora.com';
    try {
      const env = getActiveEnv();
      expect(env.clientId).toBe('ci-client-id');
      expect(env.clientSecret).toBe('ci-client-secret');
      expect(env.baseUrl).toBe('https://rest.zuora.com');
      expect(env.name).toBe('ci');
      expect(env.isProduction).toBe(false);
    } finally {
      delete process.env.ZDF_CLIENT_ID;
      delete process.env.ZDF_CLIENT_SECRET;
      delete process.env.ZDF_BASE_URL;
    }
  });

  it('env-var credentials take precedence over a config file', () => {
    writeConfig(testConfig);
    process.env.ZDF_CLIENT_ID = 'override-id';
    process.env.ZDF_CLIENT_SECRET = 'override-secret';
    process.env.ZDF_BASE_URL = 'https://rest.eu.zuora.com';
    try {
      const env = getActiveEnv();
      expect(env.clientId).toBe('override-id');
      expect(env.baseUrl).toBe('https://rest.eu.zuora.com');
    } finally {
      delete process.env.ZDF_CLIENT_ID;
      delete process.env.ZDF_CLIENT_SECRET;
      delete process.env.ZDF_BASE_URL;
    }
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
