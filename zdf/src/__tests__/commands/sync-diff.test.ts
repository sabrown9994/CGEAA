import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { Readable } from 'stream';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({
  apiGet: mockGet,
  apiPost: mockPost,
  apiPut: mockPut,
  apiDelete: mockDelete,
  apiQuery: mockQuery,
  setDebug: vi.fn(),
  setMaxRows: vi.fn(),
  APIQUERY_MAX_ROWS: 5000,
}));

// Matches the real OUTPUT_DIR default ('zdf-output') so paths in SAMPLE_DIFF (which use the
// conventional zdf-output/<subfolder>/<file> layout) resolve under the root sync-diff anchors to.
vi.mock('../../helpers/file-io.js', () => ({
  getOutputDir: vi.fn(() => 'zdf-output'),
}));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: mockReadFileSync };
});

const mockSpawnSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawnSync: mockSpawnSync }));

import { register } from '../../commands/sync-diff.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

function setStdin(content: string) {
  const fake = Readable.from([content]);
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
}

const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!;

const SAMPLE_DIFF = ['A\tzdf-output/accounts/ACC-1.json', 'D\tzdf-output/subscriptions/SUB-1.json'].join('\n');

// account (parent) must be applied before order (child); the subscription delete is ineligible
// (no create/delete command for subscription) and must never be spawned.
const APPLY_DIFF = [
  'A\tzdf-output/orders/O-1.json',
  'A\tzdf-output/accounts/ACC-1.json',
  'D\tzdf-output/subscriptions/SUB-1.json',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  Object.defineProperty(process, 'stdin', originalStdinDescriptor);
});

describe('zdf sync-diff --dry-run', () => {
  it('reads the diff from --diff-file and renders a text plan', async () => {
    mockReadFileSync.mockReturnValue(SAMPLE_DIFF);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--dry-run', '--diff-file', 'some/diff.txt']);
    expect(mockReadFileSync).toHaveBeenCalledWith('some/diff.txt', 'utf-8');
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('account');
    expect(printed).toContain('subscription');
    expect(printed).toMatch(/1 to create/);
    expect(printed).toMatch(/1 skipped/);
    logSpy.mockRestore();
  });

  it('reads the diff from stdin when --diff-file is not given', async () => {
    setStdin(SAMPLE_DIFF);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'zdf', 'sync-diff']);
    expect(mockReadFileSync).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('account');
    logSpy.mockRestore();
  });

  it('renders markdown format as a table with the required columns', async () => {
    setStdin(SAMPLE_DIFF);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--format', 'markdown']);
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('| file | status | resource | id | op | eligible | reason |');
    expect(printed).toContain('account');
    expect(printed).toContain('ACC-1');
    expect(printed).toMatch(/1 to create/);
    logSpy.mockRestore();
  });

  it('renders json format as a valid JSON array matching PlanItem shape', async () => {
    setStdin(SAMPLE_DIFF);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--format', 'json']);
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    const parsed = JSON.parse(printed);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    const account = parsed.find((p: { resource: string }) => p.resource === 'account');
    expect(account).toMatchObject({ resource: 'account', id: 'ACC-1', op: 'create', eligible: true });
    const subscription = parsed.find((p: { resource: string }) => p.resource === 'subscription');
    expect(subscription).toMatchObject({
      resource: 'subscription',
      id: 'SUB-1',
      op: 'delete',
      eligible: false,
      reason: 'no create/delete command for subscription',
    });
    logSpy.mockRestore();
  });

  it('makes zero network calls', async () => {
    setStdin(SAMPLE_DIFF);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'zdf', 'sync-diff']);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('zdf sync-diff --apply', () => {
  it('errors clearly when --apply and --dry-run are both given, without reading any diff', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--apply', '--dry-run', '--diff-file', 'some/diff.txt'])
    ).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockSpawnSync).not.toHaveBeenCalled();
    const printedErrors = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printedErrors).toContain('mutually exclusive');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('spawns the CLI for each ELIGIBLE item in planned order (parent before child); skips never spawn', async () => {
    mockReadFileSync.mockReturnValue(APPLY_DIFF);
    mockSpawnSync.mockReturnValue({ status: 0 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--apply', '--diff-file', 'apply-diff.txt']);

    const cliEntry = process.argv[1];
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [cliEntry, 'create', 'account', 'ACC-1', '--no-dependency'],
      { stdio: 'inherit', env: process.env }
    );
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [cliEntry, 'create', 'order', 'O-1', '--no-dependency'],
      { stdio: 'inherit', env: process.env }
    );

    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toMatch(/2 created/);
    expect(printed).toMatch(/1 skipped/);
    expect(printed).toMatch(/0 failed/);
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('exits 1 when an eligible action exits non-zero, but a skipped item never causes exit 1 on its own', async () => {
    mockReadFileSync.mockReturnValue(APPLY_DIFF);
    mockSpawnSync
      .mockReturnValueOnce({ status: 0 }) // account create ok
      .mockReturnValueOnce({ status: 1 }); // order create fails
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--apply', '--diff-file', 'apply-diff.txt'])
    ).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);

    exitSpy.mockRestore();
  });

  it('a diff with only a skipped item applies cleanly (no spawn, exit 0)', async () => {
    mockReadFileSync.mockReturnValue('D\tzdf-output/subscriptions/SUB-1.json');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--apply', '--diff-file', 'skip-only.txt']);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toMatch(/1 skipped/);
    expect(printed).toMatch(/0 failed/);

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('renders apply results as a JSON array with executed/ok/exitCode fields when --format json', async () => {
    mockReadFileSync.mockReturnValue(APPLY_DIFF);
    mockSpawnSync.mockReturnValue({ status: 0 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await makeProgram().parseAsync([
      'node',
      'zdf',
      'sync-diff',
      '--apply',
      '--format',
      'json',
      '--diff-file',
      'apply-diff.txt',
    ]);

    // Progress lines (output.info/success) also go through console.log — the rendered plan is
    // always the final console.log call, so JSON.parse only that one.
    const lastCall = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
    const parsed = JSON.parse(lastCall);
    expect(Array.isArray(parsed)).toBe(true);
    const account = parsed.find((p: { resource: string }) => p.resource === 'account');
    expect(account).toMatchObject({ op: 'create', executed: true, ok: true, exitCode: 0 });
    const subscription = parsed.find((p: { resource: string }) => p.resource === 'subscription');
    expect(subscription).toMatchObject({ op: 'delete', executed: false, ok: true });

    logSpy.mockRestore();
  });
});
