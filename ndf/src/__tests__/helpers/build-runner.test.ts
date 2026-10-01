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
