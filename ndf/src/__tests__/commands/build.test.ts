import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockRunBuild = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({ getProjectDir: mockGetProjectDir }));
vi.mock('../../helpers/build-runner.js', () => ({ runBuild: mockRunBuild }));

import { registerBuild } from '../../commands/build.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerBuild(p); return p;
}

const PROJECT_DIR = '/proj/NetSuite';

beforeEach(() => {
  mockGetProjectDir.mockReturnValue(PROJECT_DIR);
  mockRunBuild.mockResolvedValue(undefined);
});

describe('cgeaa netsuite build', () => {
  it('calls runBuild with dryRun:false by default', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'build']);
    expect(mockRunBuild).toHaveBeenCalledWith({ projectDir: PROJECT_DIR, dryRun: false });
  });

  it('calls runBuild with dryRun:true when --dry-run is passed', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'build', '--dry-run']);
    expect(mockRunBuild).toHaveBeenCalledWith({ projectDir: PROJECT_DIR, dryRun: true });
  });

  it('exits 1 and prints error when runBuild throws', async () => {
    mockRunBuild.mockRejectedValue(new Error('build failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'build'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore(); exitSpy.mockRestore();
  });
});
