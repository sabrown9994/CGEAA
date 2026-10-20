import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/project-dir.js', () => ({ getProjectDir: mockGetProjectDir }));
vi.mock('child_process', () => ({ spawnSync: mockSpawnSync }));

import { registerPull } from '../../commands/pull.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerPull(p); return p;
}

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockSpawnSync.mockReturnValue({ status: 0 });
});

describe('cgeaa netsuite pull object', () => {
  it('calls suitecloud object:import with correct args', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'pull', 'object', 'customscript_foo']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud',
      ['object:import', '--scriptid', 'customscript_foo',
       '--type', 'ALL', '--destinationfolder', '/Objects'],
      { stdio: 'inherit', cwd: '/proj' });
  });

  it('exits 1 when suitecloud exits non-zero', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'pull', 'object', 'customscript_foo'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('cgeaa netsuite pull file', () => {
  it('calls suitecloud file:import with correct args', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'pull', 'file', '/SuiteScripts/foo.js']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud',
      ['file:import', '--paths', '/SuiteScripts/foo.js'],
      { stdio: 'inherit', cwd: '/proj' });
  });
});
