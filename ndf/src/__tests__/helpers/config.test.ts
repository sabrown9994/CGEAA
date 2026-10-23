import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

import { readCgeaaConfig, writeCgeaaConfigKey } from '../../helpers/config.js';

const CONFIG_PATH = join(homedir(), '.cgeaa', 'config');

describe('readCgeaaConfig', () => {
  it('returns empty object when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readCgeaaConfig()).toEqual({});
  });

  it('parses key=value lines', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('netsuite_project_dir=/foo/bar\nnetsuite_production_auth_id=CG-Prod\n');
    expect(readCgeaaConfig()).toEqual({
      netsuite_project_dir: '/foo/bar',
      netsuite_production_auth_id: 'CG-Prod',
    });
  });

  it('ignores comment lines and blank lines', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# comment\n\nfoo=bar\n');
    expect(readCgeaaConfig()).toEqual({ foo: 'bar' });
  });
});

describe('writeCgeaaConfigKey', () => {
  it('creates config dir and writes key=value when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    writeCgeaaConfigKey('mykey', 'myval');
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(CONFIG_PATH, 'mykey=myval\n', 'utf-8');
  });

  it('updates existing key in place', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('other=x\nmykey=old\n');
    writeCgeaaConfigKey('mykey', 'new');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.stringContaining('mykey=new'),
      'utf-8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.stringContaining('other=x'),
      'utf-8',
    );
  });

  it('appends new key when not present', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('other=x\n');
    writeCgeaaConfigKey('newkey', 'val');
    const written = (mockWriteFileSync.mock.calls[0] as unknown[])[1] as string;
    expect(written).toContain('newkey=val');
    expect(written).toContain('other=x');
  });

  it('preserves blank lines and comments when appending new key', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# comment\n\nnetsuite_project_dir=/x\n\nother_key=val\n');
    writeCgeaaConfigKey('new_key', '123');
    const written = (mockWriteFileSync.mock.calls[0] as unknown[])[1] as string;
    expect(written).toContain('# comment');
    expect(written).toContain('new_key=123');
    expect(written).toContain('netsuite_project_dir=/x');
    expect(written).toContain('other_key=val');
    // Verify blank lines are preserved by checking the structure
    const lines = written.split('\n');
    expect(lines[0]).toBe('# comment');
    expect(lines[1]).toBe(''); // blank line
    expect(lines[2]).toBe('netsuite_project_dir=/x');
    expect(lines[3]).toBe(''); // blank line
    expect(lines[4]).toBe('other_key=val');
    expect(lines[5]).toBe('new_key=123');
  });

  it('preserves blank lines and comments when updating existing key', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# comment\n\nmykey=old\n\nother=x\n');
    writeCgeaaConfigKey('mykey', 'new');
    const written = (mockWriteFileSync.mock.calls[0] as unknown[])[1] as string;
    expect(written).toContain('# comment');
    expect(written).toContain('mykey=new');
    expect(written).toContain('other=x');
    // Verify blank lines are preserved and key is updated in place
    const lines = written.split('\n');
    expect(lines[0]).toBe('# comment');
    expect(lines[1]).toBe(''); // blank line
    expect(lines[2]).toBe('mykey=new'); // updated in place
    expect(lines[3]).toBe(''); // blank line
    expect(lines[4]).toBe('other=x');
  });
});
