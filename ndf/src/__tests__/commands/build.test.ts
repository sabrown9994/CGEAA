import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'path';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetMergeBase = vi.hoisted(() => vi.fn());
const mockGetChangedFiles = vi.hoisted(() => vi.fn());
const mockGenerateDeployXml = vi.hoisted(() => vi.fn());
const mockGenerateManifestXml = vi.hoisted(() => vi.fn());
const mockObjectIdFromPath = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({ getProjectDir: mockGetProjectDir }));
vi.mock('../../helpers/git.js', () => ({ getMergeBase: mockGetMergeBase, getChangedFiles: mockGetChangedFiles }));
vi.mock('../../helpers/xml.js', () => ({
  generateDeployXml: mockGenerateDeployXml,
  generateManifestXml: mockGenerateManifestXml,
  objectIdFromPath: mockObjectIdFromPath,
}));
vi.mock('fs', () => ({ writeFileSync: mockWriteFileSync }));

import { registerBuild } from '../../commands/build.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerBuild(p); return p;
}

const PROJECT_DIR = '/proj/NetSuite';

beforeEach(() => {
  mockGetProjectDir.mockReturnValue(PROJECT_DIR);
  mockGetMergeBase.mockReturnValue('abc123');
  mockGetChangedFiles.mockReturnValue({
    scripts: ['src/FileCabinet/SuiteScripts/foo.js'],
    objects: ['src/Objects/customscript_bar.xml'],
  });
  mockObjectIdFromPath.mockImplementation((p: string) =>
    p.replace(/^src\/Objects\//, '').replace(/\.xml$/, ''));
  mockGenerateDeployXml.mockReturnValue('<deploy>...</deploy>');
  mockGenerateManifestXml.mockReturnValue('<manifest>...</manifest>');
});

describe('cgeaa netsuite build', () => {
  it('writes deploy.xml and manifest.xml', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'build']);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join(PROJECT_DIR, 'src', 'deploy.xml'), '<deploy>...</deploy>', 'utf-8');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join(PROJECT_DIR, 'src', 'manifest.xml'), '<manifest>...</manifest>', 'utf-8');
  });

  it('--dry-run prints XML without writing files', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'build', '--dry-run']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('<deploy>'));
    logSpy.mockRestore();
  });

  it('exits 0 with warning when no relevant files changed', async () => {
    mockGetChangedFiles.mockReturnValue({ scripts: [], objects: [] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'build'])).rejects.toThrow('exit');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No scripts or objects changed'));
    expect(exitSpy).toHaveBeenCalledWith(0);
    warnSpy.mockRestore(); exitSpy.mockRestore();
  });

  it('passes changed object IDs (not paths) to generateManifestXml', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'build']);
    expect(mockGenerateManifestXml).toHaveBeenCalledWith(
      join(PROJECT_DIR, 'src', 'manifest.xml'), ['customscript_bar']);
  });
});
