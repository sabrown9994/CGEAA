import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockGetActiveAuthId = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());

const NdfConfigError = vi.hoisted(() =>
  class NdfConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NdfConfigError';
    }
  }
);

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir,
  getProductionAuthId: mockGetProductionAuthId,
  NdfConfigError: NdfConfigError,
}));
vi.mock('../../helpers/production-guard.js', () => ({ getActiveAuthId: mockGetActiveAuthId }));
vi.mock('child_process', () => ({ execSync: mockExecSync }));

import { registerEnvs } from '../../commands/envs.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerEnvs(p); return p;
}

// suitecloud account:manageauth --list output (ANSI codes stripped in implementation)
const MANAGEAUTH_OUTPUT =
  'CG-intQA | Administrator @ CarGurus - intQA | 3595813-sb6.app.netsuite.com\n' +
  'CG-Production | Administrator @ CarGurus\n' +
  'CG-UAT | Administrator @ CarGurus - StagingUAT | 3595813-sb1.app.netsuite.com\n';

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Production');
  mockGetActiveAuthId.mockReturnValue('CG-Production');
  mockExecSync.mockReturnValue(Buffer.from(MANAGEAUTH_OUTPUT));
});

describe('cgeaa netsuite envs', () => {
  it('prints all auth IDs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'envs']);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('CG-intQA');
    expect(out).toContain('CG-Production');
    expect(out).toContain('CG-UAT');
    logSpy.mockRestore();
  });

  it('marks active auth with *', async () => {
    mockGetActiveAuthId.mockReturnValue('CG-UAT');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'envs']);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/\*.*CG-UAT/);
    logSpy.mockRestore();
  });

  it('marks production auth with [PROD]', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'envs']);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('[PROD]');
    logSpy.mockRestore();
  });

  it('lists all envs when production auth id is unset', async () => {
    mockGetProductionAuthId.mockReset();
    mockGetProductionAuthId.mockImplementation(() => {
      throw new NdfConfigError('netsuite_production_auth_id not configured.');
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await makeProgram().parseAsync(['node', 'ndf', 'envs']);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const out = lines.join('\n');
    expect(out).toContain('CG-intQA');
    expect(out).toContain('CG-Production');
    expect(out).toContain('CG-UAT');
    // Check that no environment line has the [PROD] marker (only appears in hint, not as a marker)
    expect(lines.filter(l => l.includes('CG-')).every(l => !l.includes('  [PROD]'))).toBe(true);
    logSpy.mockRestore();
  });

  it('shows hint when production auth id is unset', async () => {
    mockGetProductionAuthId.mockReset();
    mockGetProductionAuthId.mockImplementation(() => {
      throw new NdfConfigError('netsuite_production_auth_id not configured.');
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Import output after module is loaded to get the actual implementation
    const { output } = await import('../../helpers/output.js');
    const infoSpy = vi.spyOn(output, 'info').mockImplementation(() => {});

    await makeProgram().parseAsync(['node', 'ndf', 'envs']);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("production auth id not configured — run 'cgeaa netsuite setup'")
    );
    logSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('errors and exits non-zero when project dir is unset (not softened by catch)', async () => {
    mockGetProjectDir.mockReset();
    mockGetProjectDir.mockImplementation(() => {
      throw new NdfConfigError('netsuite_project_dir not configured.');
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(makeProgram().parseAsync(['node', 'ndf', 'envs'])).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    // No environment listing should have occurred
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
