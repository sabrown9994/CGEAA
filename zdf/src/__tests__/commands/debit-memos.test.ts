import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { register } from '../../commands/debit-memos.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull debit-memo', () => {
  it('calls resolveAndSync with pull and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'debit-memo', 'DM-001']);
    expect(mockResolve).toHaveBeenCalledWith('debit-memo', 'DM-001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'debit-memo', 'DM-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create debit-memo', () => {
  it('reads local file, posts to invoice-scoped endpoint, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1', invoiceId: 'INV-001' });
    mockPost.mockResolvedValue({ success: true, id: 'new-dm-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'debit-memo', 'my-dm', '--invoice', 'inv-001']);
    expect(mockPost).toHaveBeenCalledWith('/v1/debit-memos/invoice/inv-001', { accountId: 'acct-1', invoiceId: 'INV-001' });
    expect(mockRename).toHaveBeenCalledWith('debit-memo', 'my-dm', 'new-dm-id');
  });

  it('exits with error when Zuora returns success false', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1' });
    mockPost.mockResolvedValue({ success: false, reasons: [{ code: 53100320, message: 'Invalid account' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'debit-memo', 'my-dm', '--invoice', 'inv-001'])
    ).rejects.toThrow('exit');
    expect(mockRename).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('throws and exits non-zero when --invoice is missing', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'debit-memo', 'my-dm'])
    ).rejects.toThrow('exit');
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf push debit-memo', () => {
  it('reads file, puts to Zuora', async () => {
    mockRead.mockReturnValue({ id: 'DM-001', debitMemoItems: [{ id: 'item-1', amount: 75 }] });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'debit-memo', 'DM-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/debit-memos/DM-001', expect.any(Object));
  });
});

describe('zdf delete debit-memo', () => {
  it('Draft memo: cancels BEFORE deleting, then resolveAndSync', async () => {
    const callOrder: string[] = [];
    mockGet.mockResolvedValue({ success: true, status: 'Draft' });
    mockPut.mockImplementation(async () => { callOrder.push('cancel'); return { success: true }; });
    mockDelete.mockImplementation(async () => { callOrder.push('delete'); return { success: true }; });
    mockResolve.mockImplementation(async () => { callOrder.push('resolve'); });
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'debit-memo', 'DM-001']);
    expect(mockGet).toHaveBeenCalledWith('/v1/debit-memos/DM-001');
    expect(mockPut).toHaveBeenCalledWith('/v1/debit-memos/DM-001/cancel', {});
    expect(mockDelete).toHaveBeenCalledWith('/v1/debit-memos/DM-001');
    expect(mockResolve).toHaveBeenCalledWith('debit-memo', 'DM-001', 'delete');
    expect(callOrder).toEqual(['cancel', 'delete', 'resolve']);
  });

  it('Canceled memo: deletes directly without cancelling', async () => {
    mockGet.mockResolvedValue({ success: true, status: 'Canceled' });
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'debit-memo', 'DM-001']);
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('/v1/debit-memos/DM-001');
  });

  it('Posted memo: rejects up front, never cancels or deletes', async () => {
    mockGet.mockResolvedValue({ success: true, status: 'Posted' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'debit-memo', 'DM-001'])
    ).rejects.toThrow('exit');
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('unexpected status (e.g. Error / in-progress): rejected, never cancels or deletes', async () => {
    mockGet.mockResolvedValue({ success: true, status: 'Generating' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'debit-memo', 'DM-001'])
    ).rejects.toThrow('exit');
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
