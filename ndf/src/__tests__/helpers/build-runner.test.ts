import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';

const mockGetMergeBase = vi.hoisted(() => vi.fn());
const mockGetChangedFiles = vi.hoisted(() => vi.fn());
const mockGenerateDeployXml = vi.hoisted(() => vi.fn());
const mockGenerateManifestXml = vi.hoisted(() => vi.fn());
const mockObjectIdFromPath = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockRunSuitecloud = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/git.js', () => ({ getMergeBase: mockGetMergeBase, getChangedFiles: mockGetChangedFiles }));
vi.mock('../../helpers/xml.js', () => ({
  generateDeployXml: mockGenerateDeployXml,
  generateManifestXml: mockGenerateManifestXml,
  objectIdFromPath: mockObjectIdFromPath,
}));
vi.mock('fs', () => ({ writeFileSync: mockWriteFileSync }));
vi.mock('../../helpers/suitecloud.js', () => ({ runSuitecloud: mockRunSuitecloud }));

import { runBuild } from '../../helpers/build-runner.js';

beforeEach(() => {
  mockGetMergeBase.mockReturnValue('abc123');
  mockGetChangedFiles.mockReturnValue({ scripts: ['src/FileCabinet/SuiteScripts/foo.js'], objects: [] });
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
