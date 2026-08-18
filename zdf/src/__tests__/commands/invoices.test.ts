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
  it('posts the file body verbatim to /v1/invoices and renames the local file to res.id', async () => {
    const body = { accountNumber: 'A00000001', invoiceDate: '2026-08-18', invoiceItems: [{ amount: 10 }] };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'INV-1' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice']);
    expect(mockPost).toHaveBeenCalledWith('/v1/invoices', body);
    expect(mockRename).toHaveBeenCalledWith('invoice', 'my-invoice', 'INV-1');
  });

  it('does NOT inject status when --post is not passed', async () => {
    const body = { accountNumber: 'A00000001', invoiceDate: '2026-08-18', invoiceItems: [{ amount: 10 }] };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'INV-1' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice']);
    const postedBody = mockPost.mock.calls[0][1];
    expect(postedBody).not.toHaveProperty('status');
  });

  it('injects status:Posted into the body and warns when --post is passed', async () => {
    const body = { accountNumber: 'A00000001', invoiceDate: '2026-08-18', invoiceItems: [{ amount: 10 }] };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'INV-1' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice', '--post']);

    expect(mockPost).toHaveBeenCalledWith('/v1/invoices', expect.objectContaining({ status: 'Posted' }));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
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
  it('cancels the invoice, then deletes it, then resolves and syncs', async () => {
    mockGet.mockResolvedValue({ status: 'Draft' });
    mockPut.mockResolvedValue({ success: true });
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    const callOrder: string[] = [];
    mockPut.mockImplementation(async () => { callOrder.push('cancel'); return { success: true }; });
    mockDelete.mockImplementation(async () => { callOrder.push('delete'); return { success: true }; });
    mockResolve.mockImplementation(async () => { callOrder.push('resolveAndSync'); return undefined; });

    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);

    expect(mockGet).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(mockPut).toHaveBeenCalledWith('/v1/invoices/INV-001/cancel', {});
    expect(mockDelete).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'delete');
    expect(callOrder).toEqual(['cancel', 'delete', 'resolveAndSync']);
  });

  it('warns but still deletes when cancel fails (already-cancelled invoice)', async () => {
    mockGet.mockResolvedValue({ status: 'Cancelled' });
    mockPut.mockResolvedValue({ success: false, reasons: [{ code: 123, message: 'already cancelled' }] });
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);

    expect(mockPut).toHaveBeenCalledWith('/v1/invoices/INV-001/cancel', {});
    expect(mockDelete).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('throws and never attempts cancel/delete when the invoice is Posted', async () => {
    mockGet.mockResolvedValue({ status: 'Posted' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001'])
    ).rejects.toThrow('exit');

    expect(mockGet).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('throws a not-found error and never attempts cancel/delete when the invoice does not exist', async () => {
    mockGet.mockResolvedValue({ success: false });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001'])
    ).rejects.toThrow('exit');

    expect(mockGet).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf delete invoice — async (jobId returned)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('confirms deletion by polling the invoice resource for disappearance (success:false)', async () => {
    mockPut.mockResolvedValue({ success: true });
    mockDelete.mockResolvedValue({ success: true, jobId: 'job-123' });
    // 1st call: leading status check (Draft, proceeds). 2nd call: poll, reports gone.
    mockGet.mockResolvedValueOnce({ status: 'Draft' });
    mockGet.mockResolvedValueOnce({ success: false, reasons: [{ code: 1, message: "Cannot find entity by key: 'INV-001'." }] });
    mockResolve.mockResolvedValue(undefined);
    const promise = makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);
    await vi.runAllTimersAsync();
    await promise;
    expect(mockGet).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'delete');
  });

  it('throws a timeout error if the invoice still exists after all polling attempts', async () => {
    mockPut.mockResolvedValue({ success: true });
    mockDelete.mockResolvedValue({ success: true, jobId: 'job-123' });
    // Leading status check and every poll call return the same still-exists shape (no success:false, not Posted).
    mockGet.mockResolvedValue({ id: 'INV-001', invoiceNumber: 'INV-001' }); // still exists — no success:false
    mockResolve.mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const promise = expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001'])
    ).rejects.toThrow('exit');
    await vi.runAllTimersAsync();
    await promise;
    // 1 leading status check + 30 poll attempts
    expect(mockGet).toHaveBeenCalledTimes(31);
    exitSpy.mockRestore();
  });
});
