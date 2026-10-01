import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync }));

import { listAuthIds, validateAuthId, setDefaultAuthId } from '../../helpers/auth.js';

const AUTH_LIST =
  'CG-intQA | Administrator @ CarGurus - intQA | 3595813-sb6.app.netsuite.com\n' +
  'CG-UAT | Administrator @ CarGurus - StagingUAT | 3595813-sb1.app.netsuite.com\n' +
  'CG-Production | Administrator @ CarGurus\n';

beforeEach(() => {
  mockExecSync.mockReturnValue(Buffer.from(AUTH_LIST));
});

describe('listAuthIds', () => {
  it('parses auth ids from manageauth --list (ANSI stripped, first pipe field)', () => {
    expect(listAuthIds('/proj')).toEqual(['CG-intQA', 'CG-UAT', 'CG-Production']);
    expect(mockExecSync).toHaveBeenCalledWith('suitecloud account:manageauth --list', { cwd: '/proj' });
  });
});

describe('validateAuthId', () => {
  it('does not throw for a known auth id', () => {
    expect(() => validateAuthId('/proj', 'CG-UAT')).not.toThrow();
  });
  it('throws for an unknown auth id, naming it', () => {
    expect(() => validateAuthId('/proj', 'CG-Typo')).toThrow(/CG-Typo/);
  });
});

describe('setDefaultAuthId', () => {
  it('writes defaultAuthId preserving other keys, tab-indented', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-intQA', other: 'x' }));
    setDefaultAuthId('/proj', 'CG-UAT');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('project.json'),
      JSON.stringify({ defaultAuthId: 'CG-UAT', other: 'x' }, null, '\t'),
      'utf-8',
    );
  });
});
