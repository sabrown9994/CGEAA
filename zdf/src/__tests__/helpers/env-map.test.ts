import { describe, it, expect, vi } from 'vitest';

const mockGetActiveEnv = vi.hoisted(() => vi.fn());
vi.mock('../../auth/config.js', () => ({ getActiveEnv: mockGetActiveEnv }));

import { ENV_MAP_KEY, activeEnvName, stripEnvMap, getEnvEntry, setEnvEntry } from '../../helpers/env-map.js';

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
