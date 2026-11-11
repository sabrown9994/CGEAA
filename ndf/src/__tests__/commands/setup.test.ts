import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// Hoisted mocks
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockHomedir = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());
const mockWriteCgeaaConfigKey = vi.hoisted(() => vi.fn());
const mockCreateInterface = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({ existsSync: mockExistsSync }));
vi.mock('os', () => ({ homedir: mockHomedir }));
vi.mock('child_process', () => ({ execSync: mockExecSync, spawnSync: mockSpawnSync }));
vi.mock('../../helpers/config.js', () => ({ writeCgeaaConfigKey: mockWriteCgeaaConfigKey }));
vi.mock('readline', () => ({ createInterface: mockCreateInterface }));

import { registerSetup, detectProjectDir, expandTilde } from '../../commands/setup.js';

function makeProgram() {
  const p = new Command();
  p.exitOverride();
  registerSetup(p);
  return p;
}

beforeEach(() => {
  mockHomedir.mockReturnValue('/Users/test');
  mockExistsSync.mockReturnValue(false);
  mockExecSync.mockReturnValue(Buffer.from('CG-Production | Admin\n'));
  mockSpawnSync.mockReturnValue({ status: 0 });
  mockWriteCgeaaConfigKey.mockImplementation(() => {});
});

describe('detectProjectDir', () => {
  it('returns FinTech Documents path when it has suitecloud.config.js', () => {
    mockHomedir.mockReturnValue('/Users/test');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/Users/test/Documents/FinTech/NetSuite/suitecloud.config.js'
    );

    const result = detectProjectDir();
    expect(result).toBe('/Users/test/Documents/FinTech/NetSuite');
  });

  it('returns FinSys Documents path when FinTech absent but FinSys present', () => {
    mockHomedir.mockReturnValue('/Users/test');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/Users/test/Documents/FinSys/NetSuite/suitecloud.config.js'
    );

    const result = detectProjectDir();
    expect(result).toBe('/Users/test/Documents/FinSys/NetSuite');
  });

  it('returns cwd/NetSuite when run from repo root', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/Users/test/repo');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/Users/test/repo/NetSuite/suitecloud.config.js'
    );

    const result = detectProjectDir();
    expect(result).toBe('/Users/test/repo/NetSuite');
  });

  it('returns process.cwd() when cwd itself is the project', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/Users/test/Documents/FinTech/NetSuite');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/Users/test/Documents/FinTech/NetSuite/suitecloud.config.js'
    );

    const result = detectProjectDir();
    expect(result).toBe('/Users/test/Documents/FinTech/NetSuite');
  });

  it('returns undefined when none match', () => {
    mockExistsSync.mockReturnValue(false);

    const result = detectProjectDir();
    expect(result).toBeUndefined();
  });

  it('prioritizes cwd over home directories', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/Users/test/custom');
    mockHomedir.mockReturnValue('/Users/test');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/Users/test/custom/suitecloud.config.js' ||
      path === '/Users/test/Documents/FinTech/NetSuite/suitecloud.config.js'
    );

    const result = detectProjectDir();
    expect(result).toBe('/Users/test/custom');
  });
});

describe('expandTilde', () => {
  it('expands ~ to homedir', () => {
    mockHomedir.mockReturnValue('/Users/test');
    expect(expandTilde('~')).toBe('/Users/test');
  });

  it('expands ~/path to homedir/path', () => {
    mockHomedir.mockReturnValue('/Users/test');
    expect(expandTilde('~/Documents/x')).toBe('/Users/test/Documents/x');
  });

  it('returns absolute path unchanged', () => {
    expect(expandTilde('/absolute/path')).toBe('/absolute/path');
  });

  it('returns relative path unchanged', () => {
    expect(expandTilde('relative/path')).toBe('relative/path');
  });

  it('does not expand tilde in the middle of path', () => {
    expect(expandTilde('/path/~/middle')).toBe('/path/~/middle');
  });
});

describe('cgeaa netsuite setup action', () => {
  it('uses detected default when user provides empty input', async () => {
    mockHomedir.mockReturnValue('/Users/test');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/Users/test/Documents/FinTech/NetSuite/suitecloud.config.js'
    );

    const mockClose = vi.fn();
    const answers = ['', 'CG-Production'];
    let answerIndex = 0;

    mockCreateInterface.mockReturnValue({
      question: (prompt: string, callback: (answer: string) => void) => {
        callback(answers[answerIndex++]);
      },
      close: mockClose,
    });

    await makeProgram().parseAsync(['node', 'ndf', 'setup']);

    expect(mockWriteCgeaaConfigKey).toHaveBeenCalledWith(
      'netsuite_project_dir',
      '/Users/test/Documents/FinTech/NetSuite'
    );
    expect(mockWriteCgeaaConfigKey).toHaveBeenCalledWith(
      'netsuite_production_auth_id',
      'CG-Production'
    );
    expect(mockClose).toHaveBeenCalled();
  });

  it('expands tilde in typed input', async () => {
    mockHomedir.mockReturnValue('/Users/test');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/Users/test/custom/NetSuite/suitecloud.config.js'
    );

    const mockClose = vi.fn();
    const answers = ['~/custom/NetSuite', 'CG-Production'];
    let answerIndex = 0;

    mockCreateInterface.mockReturnValue({
      question: (prompt: string, callback: (answer: string) => void) => {
        callback(answers[answerIndex++]);
      },
      close: mockClose,
    });

    await makeProgram().parseAsync(['node', 'ndf', 'setup']);

    expect(mockWriteCgeaaConfigKey).toHaveBeenCalledWith(
      'netsuite_project_dir',
      '/Users/test/custom/NetSuite'
    );
  });

  it('exits 1 when path lacks suitecloud.config.js', async () => {
    mockExistsSync.mockReturnValue(false);

    const mockClose = vi.fn();
    mockCreateInterface.mockReturnValue({
      question: (prompt: string, callback: (answer: string) => void) => {
        callback('/bad/path');
      },
      close: mockClose,
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never
    );

    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'setup'])
    ).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockClose).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('exits 1 when no input and no detection', async () => {
    mockExistsSync.mockReturnValue(false);

    const mockClose = vi.fn();
    mockCreateInterface.mockReturnValue({
      question: (prompt: string, callback: (answer: string) => void) => {
        callback('');
      },
      close: mockClose,
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never
    );

    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'setup'])
    ).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockClose).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('accepts explicit path and completes setup', async () => {
    mockHomedir.mockReturnValue('/Users/test');
    mockExistsSync.mockImplementation((path: string) =>
      path === '/explicit/path/suitecloud.config.js'
    );

    const mockClose = vi.fn();
    const answers = ['/explicit/path', 'CG-Production'];
    let answerIndex = 0;

    mockCreateInterface.mockReturnValue({
      question: (prompt: string, callback: (answer: string) => void) => {
        callback(answers[answerIndex++]);
      },
      close: mockClose,
    });

    await makeProgram().parseAsync(['node', 'ndf', 'setup']);

    expect(mockWriteCgeaaConfigKey).toHaveBeenCalledWith(
      'netsuite_project_dir',
      '/explicit/path'
    );
    expect(mockWriteCgeaaConfigKey).toHaveBeenCalledWith(
      'netsuite_production_auth_id',
      'CG-Production'
    );
  });

  it('closes readline interface even on early exit', async () => {
    mockExistsSync.mockReturnValue(false);

    const mockClose = vi.fn();
    mockCreateInterface.mockReturnValue({
      question: (prompt: string, callback: (answer: string) => void) => {
        callback('');
      },
      close: mockClose,
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never
    );

    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'setup'])
    ).rejects.toThrow('exit');

    expect(mockClose).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
