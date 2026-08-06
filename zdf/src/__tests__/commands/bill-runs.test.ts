import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/output.js', () => ({
  output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: mockWarn },
}));

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

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, deleteResourceFile: vi.fn(), resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT'), }));
vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import { register } from '../../commands/bill-runs.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull bill-run', () => {
  it('calls resolveAndSync with pull and reports success when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'bill-run', 'BR-001']);
    expect(mockResolve).toHaveBeenCalledWith('bill-run', 'BR-001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails (e.g. bogus id)', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'bill-run', 'BR-00003509'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create bill-run', () => {
  it('warns before executing billing, then posts to /v1/bill-runs and renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1', billRunType: 'AutoDetection' });
    mockPost.mockResolvedValue({ success: true, id: 'new-br-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'bill-run', 'my-bill-run']);
    expect(mockPost).toHaveBeenCalledWith('/v1/bill-runs', { accountId: 'acct-1', billRunType: 'AutoDetection' });
    expect(mockRename).toHaveBeenCalledWith('bill-run', 'my-bill-run', 'new-br-id');
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toMatch(/EXECUTES BILLING/);
    // the warning must be emitted before the POST, since creating a bill run
    // triggers real billing in the target tenant
    expect(mockWarn.mock.invocationCallOrder[0]).toBeLessThan(mockPost.mock.invocationCallOrder[0]);
  });

  it('exits with error when Zuora returns success false', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1' });
    mockPost.mockResolvedValue({ success: false, reasons: [{ code: 53100320, message: 'Invalid account' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'bill-run', 'my-bill-run'])
    ).rejects.toThrow('exit');
    expect(mockRename).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf push bill-run', () => {
  it('re-fetches by calling resolveAndSync with pull (no PUT endpoint)', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'bill-run', 'BR-001']);
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('bill-run', 'BR-001', 'pull');
  });

  it('throws and exits non-zero when the re-fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'bill-run', 'BR-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf delete bill-run', () => {
  it('calls delete and resolveAndSync with delete', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'bill-run', 'BR-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/bill-runs/BR-001');
    expect(mockResolve).toHaveBeenCalledWith('bill-run', 'BR-001', 'delete');
  });
});
