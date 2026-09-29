import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockGetRunTests = vi.hoisted(() => vi.fn());
const mockCheckProductionGuard = vi.hoisted(() => vi.fn());
const mockRunBuild = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId, getRunTests: mockGetRunTests }));
vi.mock('../../helpers/production-guard.js', () => ({
  checkProductionGuard: mockCheckProductionGuard,
  ProductionGuardError: class ProductionGuardError extends Error {},
}));
vi.mock('../../helpers/build-runner.js', () => ({ runBuild: mockRunBuild }));
vi.mock('child_process', () => ({ spawnSync: mockSpawnSync }));

import { registerDeploy } from '../../commands/deploy.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerDeploy(p); return p;
}

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Prod');
  mockGetRunTests.mockReturnValue(true);
  mockCheckProductionGuard.mockImplementation(() => {});
  mockRunBuild.mockResolvedValue(undefined);
  mockSpawnSync.mockReturnValue({ status: 0 });
});

describe('cgeaa netsuite deploy', () => {
  it('calls runBuild then spawnSync with suitecloud project:deploy', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy']);
    expect(mockRunBuild).toHaveBeenCalledWith({ projectDir: '/proj', dryRun: false });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud', ['project:deploy'], expect.objectContaining({ stdio: 'inherit', cwd: '/proj' }));
    const callOptions = mockSpawnSync.mock.calls[0][2];
    expect(callOptions.env).toBe(process.env);
  });

  it('--dry-run passes dryRun:true to runBuild and --dryrun to suitecloud', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--dry-run']);
    expect(mockRunBuild).toHaveBeenCalledWith({ projectDir: '/proj', dryRun: true });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud', ['project:deploy', '--dryrun'], expect.objectContaining({ stdio: 'inherit', cwd: '/proj' }));
  });

  it('--skip-tests sets NDF_SKIP_TESTS=true in env', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--skip-tests']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud', ['project:deploy'], expect.objectContaining({ stdio: 'inherit', cwd: '/proj' }));
    const callOptions = mockSpawnSync.mock.calls[0][2];
    expect(callOptions.env).toEqual(expect.objectContaining({ NDF_SKIP_TESTS: 'true' }));
  });

  it('config netsuite_run_tests=false sets NDF_SKIP_TESTS=true in env', async () => {
    mockGetRunTests.mockReturnValue(false);
    await makeProgram().parseAsync(['node', 'ndf', 'deploy']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud', ['project:deploy'], expect.objectContaining({ stdio: 'inherit', cwd: '/proj' }));
    const callOptions = mockSpawnSync.mock.calls[0][2];
    expect(callOptions.env).toEqual(expect.objectContaining({ NDF_SKIP_TESTS: 'true' }));
  });

  it('exits 1 when suitecloud exits non-zero', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
