import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';

const mockGetMergeBase = vi.hoisted(() => vi.fn());
const mockGetChangedFiles = vi.hoisted(() => vi.fn());
const mockGetCurrentBranch = vi.hoisted(() => vi.fn());
const mockGenerateDeployXml = vi.hoisted(() => vi.fn());
const mockGenerateManifestXml = vi.hoisted(() => vi.fn());
const mockObjectIdFromPath = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockRunSuitecloud = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/git.js', () => ({
  getMergeBase: mockGetMergeBase,
  getChangedFiles: mockGetChangedFiles,
  getCurrentBranch: mockGetCurrentBranch,
}));
vi.mock('../../helpers/xml.js', () => ({
  generateDeployXml: mockGenerateDeployXml,
  generateManifestXml: mockGenerateManifestXml,
  objectIdFromPath: mockObjectIdFromPath,
}));
vi.mock('fs', () => ({ writeFileSync: mockWriteFileSync }));
vi.mock('../../helpers/suitecloud.js', () => ({ runSuitecloud: mockRunSuitecloud }));

import { runBuild, warnIfSharedBranch } from '../../helpers/build-runner.js';

beforeEach(() => {
  mockGetMergeBase.mockReturnValue('abc123');
  mockGetChangedFiles.mockReturnValue({ scripts: ['src/FileCabinet/SuiteScripts/foo.js'], objects: [] });
  mockGetCurrentBranch.mockReturnValue('FINT-12345'); // feature branch by default
  mockObjectIdFromPath.mockImplementation((p: string) => p);
  mockGenerateDeployXml.mockReturnValue('<deploy/>');
  mockGenerateManifestXml.mockReturnValue('<manifest/>');
  mockRunSuitecloud.mockReturnValue({ status: 0, output: '' });
});

describe('runBuild adddependencies', () => {
  it('runs project:adddependencies after writing files (non-dry-run)', async () => {
    await runBuild({ projectDir: '/proj', dryRun: false });
    expect(mockRunSuitecloud).toHaveBeenCalledWith(['project:adddependencies'], { cwd: '/proj' });
  });

  it('does NOT run adddependencies on dry-run', async () => {
    await runBuild({ projectDir: '/proj', dryRun: true });
    expect(mockRunSuitecloud).not.toHaveBeenCalled();
  });

  it('throws if adddependencies fails', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'boom' });
    await expect(runBuild({ projectDir: '/proj', dryRun: false })).rejects.toThrow(/adddependencies/);
  });
});

describe('runBuild extraObjectPaths', () => {
  it('includes extraObjectPaths in the deploy.xml object list (deduped)', async () => {
    mockGetChangedFiles.mockReturnValue({
      scripts: [],
      objects: ['src/Objects/customscript_a.xml'],
    });
    await runBuild({
      projectDir: '/proj',
      dryRun: false,
      extraObjectPaths: ['src/Objects/customrecord_x.xml', 'src/Objects/customscript_a.xml'],
    });
    // generateDeployXml receives the union, deduped, preserving diff objects first
    expect(mockGenerateDeployXml).toHaveBeenCalledWith(
      [],
      ['src/Objects/customscript_a.xml', 'src/Objects/customrecord_x.xml'],
    );
  });

  it('builds when only extraObjectPaths are present (no diff changes)', async () => {
    mockGetChangedFiles.mockReturnValue({ scripts: [], objects: [] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    // should NOT exit 0 "nothing to build" because an extra object is present
    await runBuild({ projectDir: '/proj', dryRun: false, extraObjectPaths: ['src/Objects/customrecord_x.xml'] });
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('runBuild base option', () => {
  it('forwards default base to getMergeBase', async () => {
    await runBuild({ projectDir: '/proj', dryRun: false });
    expect(mockGetMergeBase).toHaveBeenCalledWith('/proj', 'main');
  });

  it('forwards custom base to getMergeBase', async () => {
    await runBuild({ projectDir: '/proj', dryRun: false, base: 'abc123' });
    expect(mockGetMergeBase).toHaveBeenCalledWith('/proj', 'abc123');
  });
});

describe('warnIfSharedBranch', () => {
  it('warns when on shared branch "main" with default base', async () => {
    mockGetCurrentBranch.mockReturnValue('main');
    const { output } = await import('../../helpers/output.js');
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});

    warnIfSharedBranch('/proj');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shared branch 'main'")
    );
    warnSpy.mockRestore();
  });

  it('does not warn when on feature branch', async () => {
    mockGetCurrentBranch.mockReturnValue('FINT-123');
    const { output } = await import('../../helpers/output.js');
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});

    warnIfSharedBranch('/proj');

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn when on shared branch "qa" with explicit non-main base', async () => {
    mockGetCurrentBranch.mockReturnValue('qa');
    const { output } = await import('../../helpers/output.js');
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});

    warnIfSharedBranch('/proj', 'abc123');

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('warns for all shared branches (main, master, qa, uat, staging) with default base', async () => {
    const { output } = await import('../../helpers/output.js');
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});

    for (const branch of ['main', 'master', 'qa', 'uat', 'staging']) {
      warnSpy.mockClear();
      mockGetCurrentBranch.mockReturnValue(branch);
      warnIfSharedBranch('/proj');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`shared branch '${branch}'`)
      );
    }

    warnSpy.mockRestore();
  });

  it('warns when on shared branch with explicit --base main (equivalent to default)', async () => {
    mockGetCurrentBranch.mockReturnValue('main');
    const { output } = await import('../../helpers/output.js');
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});

    warnIfSharedBranch('/proj', 'main');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shared branch 'main'")
    );
    warnSpy.mockRestore();
  });
});

describe('runBuild does not warn about shared branches', () => {
  it('runBuild on shared branch does NOT emit shared-branch warning (delegated to commands)', async () => {
    mockGetCurrentBranch.mockReturnValue('main');
    const { output } = await import('../../helpers/output.js');
    const warnSpy = vi.spyOn(output, 'warn').mockImplementation(() => {});

    await runBuild({ projectDir: '/proj', dryRun: false });

    // runBuild may emit other warnings (e.g. "nothing to build"), but NOT the shared-branch one
    const sharedBranchWarnings = warnSpy.mock.calls.filter(c => String(c[0]).includes('shared branch'));
    expect(sharedBranchWarnings).toHaveLength(0);
    warnSpy.mockRestore();
  });
});
