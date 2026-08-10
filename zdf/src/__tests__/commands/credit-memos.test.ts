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

import { register } from '../../commands/credit-memos.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull credit-memo', () => {
  it('calls resolveAndSync with pull and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'credit-memo', 'CM-001']);
    expect(mockResolve).toHaveBeenCalledWith('credit-memo', 'CM-001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'credit-memo', 'CM-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create credit-memo', () => {
  it('reads local file, posts to invoice-scoped endpoint, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1', invoiceId: 'INV-001' });
    mockPost.mockResolvedValue({ success: true, id: 'new-cm-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'credit-memo', 'my-cm', '--invoice', 'inv-001']);
    expect(mockPost).toHaveBeenCalledWith('/v1/credit-memos/invoice/inv-001', { accountId: 'acct-1', invoiceId: 'INV-001' });
    expect(mockRename).toHaveBeenCalledWith('credit-memo', 'my-cm', 'new-cm-id');
  });

  it('exits with error when Zuora returns success false', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1' });
    mockPost.mockResolvedValue({ success: false, reasons: [{ code: 53100320, message: 'Invalid account' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'credit-memo', 'my-cm', '--invoice', 'inv-001'])
    ).rejects.toThrow('exit');
    expect(mockRename).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('throws and exits non-zero when --invoice is missing', async () => {
    mockRead.mockReturnValue({ accountId: 'acct-1' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'credit-memo', 'my-cm'])
    ).rejects.toThrow('exit');
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf push credit-memo', () => {
  it('reads file, puts to Zuora', async () => {
    mockRead.mockReturnValue({ id: 'CM-001', creditMemoItems: [{ id: 'item-1', amount: 50 }] });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/credit-memos/CM-001', expect.any(Object));
  });
});

describe('zdf delete credit-memo', () => {
  it('calls delete and resolveAndSync with delete', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'credit-memo', 'CM-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/credit-memos/CM-001');
    expect(mockResolve).toHaveBeenCalledWith('credit-memo', 'CM-001', 'delete');
  });
});
