import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockGetRunTests = vi.hoisted(() => vi.fn());
const mockGetActiveAuthId = vi.hoisted(() => vi.fn());
const mockGetCurrentBranch = vi.hoisted(() => vi.fn());
const mockValidateAuthId = vi.hoisted(() => vi.fn());
const mockSetDefaultAuthId = vi.hoisted(() => vi.fn());
const mockRunSuitecloud = vi.hoisted(() => vi.fn());
const mockParseMissing = vi.hoisted(() => vi.fn());
const mockRunBuild = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId, getRunTests: mockGetRunTests,
}));
vi.mock('../../helpers/production-guard.js', () => ({
  getActiveAuthId: mockGetActiveAuthId,
  ProductionGuardError: class ProductionGuardError extends Error {},
}));
vi.mock('../../helpers/git.js', () => ({ getCurrentBranch: mockGetCurrentBranch }));
vi.mock('../../helpers/auth.js', () => ({ validateAuthId: mockValidateAuthId, setDefaultAuthId: mockSetDefaultAuthId }));
vi.mock('../../helpers/suitecloud.js', () => ({ runSuitecloud: mockRunSuitecloud }));
vi.mock('../../helpers/dependency-parser.js', () => ({ parseMissingObjectRefs: mockParseMissing }));
vi.mock('../../helpers/build-runner.js', () => ({ runBuild: mockRunBuild }));

import { registerDeploy } from '../../commands/deploy.js';

function makeProgram() { const p = new Command(); p.exitOverride(); registerDeploy(p); return p; }

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Production');
  mockGetRunTests.mockReturnValue(true);
  mockGetActiveAuthId.mockReturnValue('CG-intQA');
  mockGetCurrentBranch.mockReturnValue('feature/x');
  mockValidateAuthId.mockImplementation(() => {});
  mockSetDefaultAuthId.mockImplementation(() => {});
  mockRunBuild.mockResolvedValue(undefined);
  mockRunSuitecloud.mockReturnValue({ status: 0, output: 'SUCCESS' });
  mockParseMissing.mockReturnValue([]);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  // default: non-interactive (CI) unless a test sets isTTY
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

describe('deploy happy path', () => {
  it('deploys to --target on first success and restores defaultAuthId', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT']);
    expect(mockValidateAuthId).toHaveBeenCalledWith('/proj', 'CG-UAT');
    expect(mockSetDefaultAuthId).toHaveBeenCalledWith('/proj', 'CG-UAT');   // swapped to target
    expect(mockRunSuitecloud).toHaveBeenCalledWith(['project:deploy'], expect.objectContaining({ cwd: '/proj' }));
    expect(mockSetDefaultAuthId).toHaveBeenLastCalledWith('/proj', 'CG-intQA'); // restored
  });

  it('passes --base option to runBuild', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--base', 'someSha']);
    expect(mockRunBuild).toHaveBeenCalledWith(expect.objectContaining({ base: 'someSha' }));
  });
});

describe('production guard on --target', () => {
  it('blocks deploying to production off main (exit 1), no swap', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-Production']))
      .rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockRunSuitecloud).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('blocks prod deploy on main without --allow-production', async () => {
    mockGetCurrentBranch.mockReturnValue('main');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-Production']))
      .rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockRunSuitecloud).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('allows prod deploy on main with --allow-production', async () => {
    mockGetCurrentBranch.mockReturnValue('main');
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-Production', '--allow-production']);
    expect(mockRunSuitecloud).toHaveBeenCalledWith(['project:deploy'], expect.objectContaining({ cwd: '/proj' }));
  });

  it('blocks prod deploy off main even with --allow-production (branch guard takes precedence)', async () => {
    mockGetCurrentBranch.mockReturnValue('feature/x');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-Production', '--allow-production']))
      .rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockRunSuitecloud).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('unknown target (typo)', () => {
  it('fails fast and never swaps defaultAuthId', async () => {
    mockValidateAuthId.mockImplementation((_d: string, id: string) => { if (id === 'CG-Typo') throw new Error('Unknown auth ID "CG-Typo".'); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-Typo'])).rejects.toThrow('exit');
    expect(mockSetDefaultAuthId).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('unparseable failure', () => {
  it('fails and surfaces raw error without importing', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'some other failure' });
    mockParseMissing.mockReturnValue([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT'])).rejects.toThrow('exit');
    // only deploy attempted; no object:import
    expect(mockRunSuitecloud).toHaveBeenCalledTimes(1);
    expect(mockSetDefaultAuthId).toHaveBeenLastCalledWith('/proj', 'CG-intQA'); // restored even on failure
    exitSpy.mockRestore();
  });
});

describe('CI needs import without --auto-import', () => {
  it('fails with the named list and imports nothing', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'missing' });
    mockParseMissing.mockReturnValue(['customrecord_x']);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA']))
      .rejects.toThrow('exit');
    // no object:import call (only the single deploy attempt)
    const importCalls = mockRunSuitecloud.mock.calls.filter((c) => (c[0] as string[])[0] === 'object:import');
    expect(importCalls.length).toBe(0);
    exitSpy.mockRestore();
  });
});

describe('CI auto-import then success', () => {
  it('imports named objects from --source, rebuilds, retries, succeeds', async () => {
    mockRunSuitecloud
      .mockReturnValueOnce({ status: 1, output: 'missing customrecord_x' })  // deploy #1 fails
      .mockReturnValueOnce({ status: 0, output: 'imported' })                 // object:import
      .mockReturnValueOnce({ status: 0, output: 'SUCCESS' });                 // deploy #2 ok
    mockParseMissing.mockReturnValueOnce(['customrecord_x']).mockReturnValue([]);
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA', '--auto-import']);
    const importCall = mockRunSuitecloud.mock.calls.find((c) => (c[0] as string[])[0] === 'object:import');
    expect(importCall?.[0]).toEqual(['object:import', '--scriptid', 'customrecord_x', '--type', 'ALL', '--destinationfolder', '/Objects']);
    // import ran against source
    expect(mockSetDefaultAuthId).toHaveBeenCalledWith('/proj', 'CG-intQA');
    // second runBuild received the imported object path
    expect(mockRunBuild).toHaveBeenLastCalledWith(expect.objectContaining({ extraObjectPaths: ['src/Objects/customrecord_x.xml'] }));
    expect(mockSetDefaultAuthId).toHaveBeenLastCalledWith('/proj', 'CG-intQA'); // restored
  });
});

describe('max rounds cap', () => {
  it('fails after --max-import-rounds when object stays missing', async () => {
    mockRunSuitecloud.mockImplementation((args: string[]) => (args[0] === 'object:import' ? { status: 0, output: '' } : { status: 1, output: 'missing' }));
    mockParseMissing.mockReturnValue(['customrecord_x']);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA', '--auto-import', '--max-import-rounds', '2']))
      .rejects.toThrow('exit');
    const deployCalls = mockRunSuitecloud.mock.calls.filter((c) => (c[0] as string[])[0] === 'project:deploy');
    expect(deployCalls.length).toBe(2); // capped at 2 rounds
    exitSpy.mockRestore();
  });
});

describe('dry-run', () => {
  it('validates (not deploys) and reports would-import without importing', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'missing' });
    mockParseMissing.mockReturnValue(['customrecord_x']);
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA', '--dry-run']);
    expect(mockRunSuitecloud).toHaveBeenCalledWith(['project:validate'], expect.objectContaining({ cwd: '/proj' }));
    const importCalls = mockRunSuitecloud.mock.calls.filter((c) => (c[0] as string[])[0] === 'object:import');
    expect(importCalls.length).toBe(0);
  });
});
