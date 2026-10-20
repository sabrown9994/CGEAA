import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockGetActiveAuthId = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId }));
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
});
