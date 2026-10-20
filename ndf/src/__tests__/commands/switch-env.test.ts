import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'path';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockGetCurrentBranch = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId }));
vi.mock('../../helpers/production-guard.js', () => ({
  ProductionGuardError: class ProductionGuardError extends Error {
    constructor(branch: string) {
      super(`Cannot deploy/switch to production outside of main.\nCurrent branch: ${branch}. Merge your changes to main first.`);
    }
  },
}));
vi.mock('../../helpers/git.js', () => ({ getCurrentBranch: mockGetCurrentBranch }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync }));

import { registerSwitch } from '../../commands/switch-env.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerSwitch(p); return p;
}

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Prod');
  mockGetCurrentBranch.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-intQA' }));
});

describe('cgeaa netsuite switch', () => {
  it('writes new defaultAuthId to project.json', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-UAT']);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/proj', 'project.json'),
      JSON.stringify({ defaultAuthId: 'CG-UAT' }, null, '\t'),
      'utf-8');
  });

  it('blocks switching TO production when not on main', async () => {
    mockGetCurrentBranch.mockReturnValue('feature/x');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-Prod'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('allows switching TO sandbox even when not on main', async () => {
    mockGetCurrentBranch.mockReturnValue('feature/x');
    await makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-intQA']);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});
