import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

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

import { register } from '../../commands/invoices.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull invoice', () => {
  it('calls resolveAndSync with pull and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'invoice', 'INV-001']);
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'invoice', 'INV-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create invoice', () => {
  it('reads local file, posts to /v1/invoices, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1', invoiceDate: '2026-08-06' });
    mockPost.mockResolvedValue({ success: true, id: 'new-inv-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice']);
    expect(mockPost).toHaveBeenCalledWith('/v1/invoices', { accountId: 'acct-1', invoiceDate: '2026-08-06' });
    expect(mockRename).toHaveBeenCalledWith('invoice', 'my-invoice', 'new-inv-id');
  });

  it('exits with error when Zuora returns success false', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1' });
    mockPost.mockResolvedValue({ success: false, reasons: [{ code: 53100320, message: 'Invalid account' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice'])
    ).rejects.toThrow('exit');
    expect(mockRename).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf push invoice', () => {
  it('reads file, puts to Zuora', async () => {
    mockRead.mockReturnValue({ id: 'INV-001', invoiceItems: [{ id: 'item-1', amount: 100 }] });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/invoices/INV-001', expect.any(Object));
  });
});

describe('zdf delete invoice', () => {
  it('calls delete and resolveAndSync with delete', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'delete');
  });
});

describe('zdf delete invoice — async (jobId returned)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('polls async-jobs endpoint until Completed', async () => {
    mockDelete.mockResolvedValue({ success: true, jobId: 'job-123' });
    mockGet
      .mockResolvedValueOnce({ jobStatus: 'Processing' })
      .mockResolvedValueOnce({ jobStatus: 'Completed' });
    mockResolve.mockResolvedValue(undefined);
    const promise = makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);
    await vi.runAllTimersAsync();
    await promise;
    expect(mockGet).toHaveBeenCalledWith('/v1/async-jobs/job-123');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'delete');
  });
});
