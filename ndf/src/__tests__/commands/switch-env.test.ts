import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'path';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockCheckProductionGuard = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId }));
vi.mock('../../helpers/production-guard.js', () => ({
  checkProductionGuard: mockCheckProductionGuard,
  ProductionGuardError: class ProductionGuardError extends Error {},
}));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync }));

import { registerSwitch } from '../../commands/switch-env.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerSwitch(p); return p;
}

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Prod');
  mockCheckProductionGuard.mockImplementation(() => {});
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

  it('calls checkProductionGuard with project dir and production auth ID', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-Prod']);
    expect(mockCheckProductionGuard).toHaveBeenCalledWith('/proj', 'CG-Prod');
  });

  it('exits 1 when production guard throws', async () => {
    mockCheckProductionGuard.mockImplementation(() => {
      throw new Error('Merge your changes to main first');
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-Prod'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
