import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetActiveEnv = vi.hoisted(() => vi.fn());
vi.mock('../../auth/config.js', () => ({ getActiveEnv: mockGetActiveEnv }));

const mockReadResourceFile = vi.hoisted(() => vi.fn());
const mockReadResourceFileIfExists = vi.hoisted(() => vi.fn());
const mockWriteResourceFile = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({
  readResourceFile: mockReadResourceFile,
  readResourceFileIfExists: mockReadResourceFileIfExists,
  writeResourceFile: mockWriteResourceFile,
}));

import {
  ENV_MAP_KEY, activeEnvName, stripEnvMap, getEnvEntry, setEnvEntry,
  mergeExistingEnvMap, carryForwardEnvMap, carryForwardEnvMapToFile,
} from '../../helpers/env-map.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('activeEnvName', () => {
  it('returns getActiveEnv().name', () => {
    mockGetActiveEnv.mockReturnValue({ name: 'intQA', isProduction: false });
    expect(activeEnvName()).toBe('intQA');
  });
});

describe('stripEnvMap', () => {
  it('removes the _zdf key and returns a clone (original untouched)', () => {
    const original = { id: '1', [ENV_MAP_KEY]: { intQA: { id: 'a', key: 'k' } } };
    const stripped = stripEnvMap(original);
    expect(stripped).toEqual({ id: '1' });
    expect(ENV_MAP_KEY in original).toBe(true);
    expect(original[ENV_MAP_KEY]).toEqual({ intQA: { id: 'a', key: 'k' } });
  });

  it('is a no-op for objects without _zdf', () => {
    const body = { id: '1', name: 'x' };
    expect(stripEnvMap(body)).toEqual({ id: '1', name: 'x' });
  });

  it('is a safe no-op for null, undefined, arrays, and non-objects', () => {
    expect(stripEnvMap(null)).toBe(null);
    expect(stripEnvMap(undefined)).toBe(undefined);
    const arr = [1, 2, 3];
    expect(stripEnvMap(arr)).toBe(arr);
    expect(stripEnvMap('a string' as unknown as Record<string, unknown>)).toBe('a string');
    expect(stripEnvMap(42 as unknown as Record<string, unknown>)).toBe(42);
  });
});

describe('getEnvEntry / setEnvEntry round-trip', () => {
  it('round-trips a single env entry', () => {
    const record: Record<string, unknown> = { id: '1' };
    setEnvEntry(record, 'intQA', { id: 'zuora-id-1', key: 'ACG-1' });
    expect(getEnvEntry(record, 'intQA')).toEqual({ id: 'zuora-id-1', key: 'ACG-1' });
  });

  it('returns undefined for an env with no entry', () => {
    const record: Record<string, unknown> = { id: '1' };
    expect(getEnvEntry(record, 'staging')).toBeUndefined();
  });

  it('preserves a different env\'s entry when setting a new one', () => {
    const record: Record<string, unknown> = {
      id: '1',
      [ENV_MAP_KEY]: { staging: { id: 'staging-id', key: 'staging-key' } },
    };
    setEnvEntry(record, 'intQA', { id: 'intqa-id', key: 'intqa-key' });
    expect(getEnvEntry(record, 'staging')).toEqual({ id: 'staging-id', key: 'staging-key' });
    expect(getEnvEntry(record, 'intQA')).toEqual({ id: 'intqa-id', key: 'intqa-key' });
  });

  it('merges into an existing entry, only overwriting fields that are provided', () => {
    const record: Record<string, unknown> = {
      id: '1',
      [ENV_MAP_KEY]: { intQA: { id: 'old-id', key: 'old-key' } },
    };
    setEnvEntry(record, 'intQA', { key: 'new-key' });
    expect(getEnvEntry(record, 'intQA')).toEqual({ id: 'old-id', key: 'new-key' });
  });

  it('returns the mutated record', () => {
    const record: Record<string, unknown> = { id: '1' };
    const result = setEnvEntry(record, 'intQA', { id: 'x', key: 'y' });
    expect(result).toBe(record);
  });
});

describe('mergeExistingEnvMap', () => {
  it('accumulates across envs: a file with _zdf.prod, re-written under intQA, ends up with BOTH', () => {
    mockReadResourceFileIfExists.mockReturnValue({
      id: '1',
      [ENV_MAP_KEY]: { prod: { id: 'prod-id', key: 'PROD-1' } },
    });
    const record: Record<string, unknown> = { id: '1' };
    setEnvEntry(record, 'intQA', { id: 'intqa-id', key: 'INTQA-1' });
    const merged = mergeExistingEnvMap('account', '1', record);
    expect(getEnvEntry(merged, 'prod')).toEqual({ id: 'prod-id', key: 'PROD-1' });
    expect(getEnvEntry(merged, 'intQA')).toEqual({ id: 'intqa-id', key: 'INTQA-1' });
  });

  it('keys the lookup on the fileNameFor-derived filename (natural key), not the id — so it finds the existing file even when the REAL per-tenant internal id differs', () => {
    mockReadResourceFileIfExists.mockReturnValue({
      basicInfo: { id: 'prod-abc', accountNumber: 'ACG1' },
      [ENV_MAP_KEY]: { prod: { id: 'prod-abc', key: 'ACG1' } },
    });
    // record's OWN id ('intqa-999') differs from the prior tenant's id ('prod-abc') stored in the
    // existing file — only accountNumber ('ACG1') is stable across tenants.
    const record: Record<string, unknown> = { basicInfo: { id: 'intqa-999', accountNumber: 'ACG1' } };
    setEnvEntry(record, 'intQA', { id: 'intqa-999', key: 'ACG1' });
    const merged = mergeExistingEnvMap('account', 'intqa-999', record);
    expect(mockReadResourceFileIfExists).toHaveBeenCalledWith('account', 'ACG1');
    expect(getEnvEntry(merged, 'prod')).toEqual({ id: 'prod-abc', key: 'ACG1' });
    expect(getEnvEntry(merged, 'intQA')).toEqual({ id: 'intqa-999', key: 'ACG1' });
  });

  it('the active env entry on `record` wins over a stale entry for the same env in the existing file', () => {
    mockReadResourceFileIfExists.mockReturnValue({
      id: '1',
      [ENV_MAP_KEY]: { intQA: { id: 'stale-id', key: 'STALE-1' } },
    });
    const record: Record<string, unknown> = { id: '1' };
    setEnvEntry(record, 'intQA', { id: 'fresh-id', key: 'FRESH-1' });
    const merged = mergeExistingEnvMap('account', '1', record);
    expect(getEnvEntry(merged, 'intQA')).toEqual({ id: 'fresh-id', key: 'FRESH-1' });
  });

  it('is a no-op when no local file exists yet (first pull/create)', () => {
    mockReadResourceFileIfExists.mockReturnValue(undefined);
    const record: Record<string, unknown> = { id: '1' };
    setEnvEntry(record, 'intQA', { id: 'x', key: 'y' });
    const merged = mergeExistingEnvMap('account', '1', record);
    expect(getEnvEntry(merged, 'intQA')).toEqual({ id: 'x', key: 'y' });
    expect(merged[ENV_MAP_KEY]).toEqual({ intQA: { id: 'x', key: 'y' } });
  });

  it('is a no-op when the existing file has no _zdf map at all', () => {
    mockReadResourceFileIfExists.mockReturnValue({ id: '1', name: 'plain record' });
    const record: Record<string, unknown> = { id: '1' };
    setEnvEntry(record, 'intQA', { id: 'x', key: 'y' });
    const merged = mergeExistingEnvMap('account', '1', record);
    expect(merged[ENV_MAP_KEY]).toEqual({ intQA: { id: 'x', key: 'y' } });
  });

  it('returns the mutated record', () => {
    mockReadResourceFileIfExists.mockReturnValue(undefined);
    const record: Record<string, unknown> = { id: '1' };
    const result = mergeExistingEnvMap('account', '1', record);
    expect(result).toBe(record);
  });
});

describe('carryForwardEnvMap (pure, in-memory)', () => {
  it('merges priorMap in, with record\'s own (fresh) entries winning for the same env', () => {
    const record: Record<string, unknown> = {};
    setEnvEntry(record, 'intQA', { id: 'fresh-id', key: 'ACG1' });
    const priorMap = { prod: { id: 'prod-id', key: 'ACG1' }, intQA: { id: 'stale-id', key: 'STALE' } };
    const merged = carryForwardEnvMap(record, priorMap);
    expect(getEnvEntry(merged, 'prod')).toEqual({ id: 'prod-id', key: 'ACG1' });
    expect(getEnvEntry(merged, 'intQA')).toEqual({ id: 'fresh-id', key: 'ACG1' }); // fresh wins
  });

  it('is a no-op when priorMap is undefined or empty', () => {
    const record: Record<string, unknown> = { [ENV_MAP_KEY]: { intQA: { id: 'x', key: 'y' } } };
    carryForwardEnvMap(record, undefined);
    expect(record[ENV_MAP_KEY]).toEqual({ intQA: { id: 'x', key: 'y' } });
    carryForwardEnvMap(record, {});
    expect(record[ENV_MAP_KEY]).toEqual({ intQA: { id: 'x', key: 'y' } });
  });

  it('returns the mutated record', () => {
    const record: Record<string, unknown> = {};
    const result = carryForwardEnvMap(record, { prod: { id: 'x', key: 'y' } });
    expect(result).toBe(record);
  });
});

describe('carryForwardEnvMapToFile (disk read-merge-write)', () => {
  it('reads the final file, merges priorMap in, and writes it back', () => {
    mockReadResourceFile.mockReturnValue({
      id: 'target-id',
      [ENV_MAP_KEY]: { intQA: { id: 'target-id', key: 'ACG1' } },
    });
    const priorMap = { prod: { id: 'prod-abc', key: 'ACG1' } };
    carryForwardEnvMapToFile('product', 'target-id', priorMap);
    expect(mockReadResourceFile).toHaveBeenCalledWith('product', 'target-id');
    expect(mockWriteResourceFile).toHaveBeenCalledWith('product', 'target-id', expect.objectContaining({
      [ENV_MAP_KEY]: {
        prod: { id: 'prod-abc', key: 'ACG1' },
        intQA: { id: 'target-id', key: 'ACG1' },
      },
    }));
  });

  it('is a no-op (no read/write) when priorMap is undefined or empty', () => {
    carryForwardEnvMapToFile('product', 'target-id', undefined);
    carryForwardEnvMapToFile('product', 'target-id', {});
    expect(mockReadResourceFile).not.toHaveBeenCalled();
    expect(mockWriteResourceFile).not.toHaveBeenCalled();
  });

  it('is a no-op when the just-written final file cannot be read (nothing to carry the map onto)', () => {
    mockReadResourceFile.mockImplementation(() => { throw new Error('No file found'); });
    carryForwardEnvMapToFile('product', 'target-id', { prod: { id: 'x', key: 'y' } });
    expect(mockWriteResourceFile).not.toHaveBeenCalled();
  });
});
