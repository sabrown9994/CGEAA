import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const testOutputDir = join(os.tmpdir(), `zdf-fileio-test-${Date.now()}`);
process.env.ZDF_OUTPUT_DIR = testOutputDir;

import { readResourceFile, writeResourceFile, renameResourceFile, resolveFilePath, deleteResourceFile, readResourceFileByIdOrName } from '../../helpers/file-io.js';

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

describe('readResourceFileByIdOrName (natural-key resource, e.g. invoice)', () => {
  const invoiceRecord = { id: 'inv-internal-1', invoiceNumber: 'INV-1', _zdf: { intQA: { id: 'intqa-inv-9', key: 'INV-1-INTQA' } } };

  it('resolves by the natural key (direct filename match)', () => {
    writeResourceFile('invoice', 'inv-internal-1', invoiceRecord);
    expect(readResourceFileByIdOrName('invoice', 'INV-1')).toMatchObject({ invoiceNumber: 'INV-1' });
  });

  it('resolves by the INTERNAL id via the stored-id scan fallback, even though the file is named by natural key', () => {
    writeResourceFile('invoice', 'inv-internal-1', invoiceRecord);
    // The file on disk is invoices/INV-1.json (natural-key-named) — 'inv-internal-1' matches no
    // filename directly, only the record's stored `id` field inside that file.
    expect(existsSync(join(testOutputDir, 'invoices', 'INV-1.json'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'invoices', 'inv-internal-1.json'))).toBe(false);
    expect(readResourceFileByIdOrName('invoice', 'inv-internal-1')).toMatchObject({ invoiceNumber: 'INV-1' });
  });

  it('resolves by a SOURCE-tenant id stored in _zdf (cross-tenant FK lookup after a push re-fetch)', () => {
    // After a cross-tenant push the file is re-fetched from the target tenant, so its own `id`
    // becomes the target id — but a sibling FK still references the source id, which survives in
    // `_zdf[sourceEnv].id`. Lookup by that source id must still find the file.
    writeResourceFile('invoice', 'inv-internal-1', invoiceRecord);
    expect(readResourceFileByIdOrName('invoice', 'intqa-inv-9')).toMatchObject({ invoiceNumber: 'INV-1' });
  });

  it('returns undefined (never throws) when neither the name, stored id, nor any _zdf id matches', () => {
    writeResourceFile('invoice', 'inv-internal-1', invoiceRecord);
    expect(readResourceFileByIdOrName('invoice', 'nope-not-here')).toBeUndefined();
  });

  it('returns undefined (never throws) when the resource directory does not exist at all', () => {
    expect(readResourceFileByIdOrName('invoice', 'anything')).toBeUndefined();
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
