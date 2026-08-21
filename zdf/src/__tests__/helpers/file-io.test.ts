import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const testOutputDir = join(os.tmpdir(), `zdf-fileio-test-${Date.now()}`);
process.env.ZDF_OUTPUT_DIR = testOutputDir;

import { readResourceFile, writeResourceFile, renameResourceFile, resolveFilePath, deleteResourceFile } from '../../helpers/file-io.js';

afterEach(() => { if (existsSync(testOutputDir)) rmSync(testOutputDir, { recursive: true }); });

describe('natural-key file naming round-trip (account, keyed by accountNumber)', () => {
  const record = { basicInfo: { id: 'internal-id-1', accountNumber: 'ACG00099' }, name: 'Acme' };

  it('writes an account under its accountNumber, not the internal id', () => {
    const path = writeResourceFile('account', 'internal-id-1', record);
    expect(path).toMatch(/accounts\/ACG00099\.json$/);
    expect(existsSync(join(testOutputDir, 'accounts', 'ACG00099.json'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'accounts', 'internal-id-1.json'))).toBe(false);
  });

  it('reads back by the natural key (direct) AND by the internal id (stored-id fallback)', () => {
    writeResourceFile('account', 'internal-id-1', record);
    expect(readResourceFile('account', 'ACG00099')).toMatchObject({ name: 'Acme' });      // direct
    expect(readResourceFile('account', 'internal-id-1')).toMatchObject({ name: 'Acme' });  // fallback by stored id
  });

  it('deletes the natural-key-named file when cleaning up by internal id (no orphan)', () => {
    writeResourceFile('account', 'internal-id-1', record);
    deleteResourceFile('account', 'internal-id-1');
    expect(existsSync(join(testOutputDir, 'accounts', 'ACG00099.json'))).toBe(false);
  });

  it('error message hints at natural-key naming when a natural-keyed file is missing', () => {
    expect(() => readResourceFile('account', 'nope')).toThrow(/named by their natural key/);
  });
});

describe('writeResourceFile / readResourceFile', () => {
  it('writes and reads back a JSON resource', () => {
    writeResourceFile('accounts', 'acc-1', { id: 'acc-1', name: 'Test' });
    const result = readResourceFile('accounts', 'acc-1');
    expect(result).toEqual({ id: 'acc-1', name: 'Test' });
  });

  it('reads a .sql file when ext is sql', () => {
    writeResourceFile('data-queries', 'q1', 'SELECT * FROM Account', 'sql');
    const result = readResourceFile('data-queries', 'q1', 'sql');
    expect(result).toBe('SELECT * FROM Account');
  });

  it('throws when file does not exist', () => {
    expect(() => readResourceFile('accounts', 'missing')).toThrow('No file found');
  });
});

describe('renameResourceFile', () => {
  it('renames a file from old name to new id', () => {
    writeResourceFile('accounts', 'my-new-account', { name: 'Test' });
    renameResourceFile('accounts', 'my-new-account', 'zuora-id-123');
    expect(existsSync(join(testOutputDir, 'accounts', 'zuora-id-123.json'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'accounts', 'my-new-account.json'))).toBe(false);
  });
});

describe('resolveFilePath', () => {
  it('resolves correct path using RESOURCE_SUBFOLDERS mapping via resourceType key', () => {
    // 'account' maps to 'accounts' subfolder via RESOURCE_SUBFOLDERS
    const p = resolveFilePath('account', 'acc-123');
    expect(p).toBe(join(testOutputDir, 'accounts', 'acc-123.json'));
  });

  it('resolves correct path for sql extension', () => {
    const p = resolveFilePath('data-query', 'my-query', 'sql');
    expect(p).toBe(join(testOutputDir, 'data-queries', 'my-query.sql'));
  });
});
