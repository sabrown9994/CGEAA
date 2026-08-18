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

vi.mock('../../helpers/file-io.js', () => ({
  getOutputDir: vi.fn(() => 'MOCK_OUTPUT'),
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
  it('throws a clear not-yet-implemented error and exits 1, without reading any diff', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'sync-diff', '--apply', '--diff-file', 'some/diff.txt'])
    ).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    const printedErrors = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printedErrors).toContain('not yet implemented (Phase 2)');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
