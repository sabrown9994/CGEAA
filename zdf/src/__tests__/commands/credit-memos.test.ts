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
  getLastPulledPath: vi.fn(() => null),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockReadByIdOrName = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, readResourceFileByIdOrName: mockReadByIdOrName, renameResourceFile: mockRename, deleteResourceFile: mockDeleteFile, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT'), }));
vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

// resolveTargetId is mocked per-test (drives the push upsert branch); matchInvoiceItems is kept
// real (pure) — mirrors invoices.test.ts / products.test.ts.
const mockResolveTargetId = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/upsert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../helpers/upsert.js')>();
  return { ...actual, resolveTargetId: mockResolveTargetId };
});

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

  it('the body posted to Zuora never carries a _zdf map (create off a file that was previously pulled)', async () => {
    const body = { accountId: 'acct-1', invoiceId: 'INV-001', _zdf: { sandbox: { id: 'old-id', key: 'OLD-1' } } };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'new-cm-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'credit-memo', 'my-cm', '--invoice', 'inv-001']);
    const postedBody = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(postedBody).not.toHaveProperty('_zdf');
  });

  it('records _zdf[<env>] on the written file after create, before renaming', async () => {
    const body = { accountId: 'acct-1', invoiceId: 'INV-001' };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'new-cm-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'credit-memo', 'my-cm', '--invoice', 'inv-001']);
    expect(mockWrite).toHaveBeenCalledWith('credit-memo', 'my-cm', expect.objectContaining({
      _zdf: { sandbox: { id: 'new-cm-id', key: null } },
    }));
    expect(mockRename).toHaveBeenCalledWith('credit-memo', 'my-cm', 'new-cm-id');
  });
});

describe('zdf push credit-memo', () => {
  it('target found: PUTs the RESOLVED id, header fields only (creditMemoItems stripped), and calls resolveAndSync', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'resolved-cm-id', found: true });
    mockRead.mockReturnValue({
      memoNumber: 'CM-001',
      comment: 'hi',
      reasonCode: 'Adjustment',
      creditMemoItems: [{ id: 'item-1', amount: 50 }],
    });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001']);

    expect(mockPut).toHaveBeenCalledWith('/v1/credit-memos/resolved-cm-id', { comment: 'hi', reasonCode: 'Adjustment' });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('credit-memo', 'resolved-cm-id', 'push');
  });

  it('target found: the body PUT to Zuora never carries a _zdf map', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'CM-001', found: true });
    mockRead.mockReturnValue({
      memoNumber: 'CM-001',
      comment: 'hi',
      _zdf: { sandbox: { id: 'CM-001', key: 'CM-001' } },
    });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001']);

    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });

  it('target not found: creates from the source invoice, remapping each item\'s invoiceItemId to the matched target-invoice item', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({
      invoiceId: 'source-inv-id',
      comment: 'Promoted from source',
      reasonCode: 'Adjustment',
      effectiveDate: '2026-08-24',
      creditMemoItems: [{ invoiceItemId: 'source-item-1', skuName: 'SKU-A', amount: 100 }],
    });
    mockReadByIdOrName.mockReturnValue({ _zdf: { sandbox: { id: 'target-inv-internal-id', key: 'INV-ACTIVE' } } });
    mockGet.mockResolvedValue({ invoiceItems: [{ id: 'target-item-1', skuName: 'SKU-A', amount: 100 }] });
    mockPost.mockResolvedValue({ success: true, id: 'new-cm-id' });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001']);

    expect(mockReadByIdOrName).toHaveBeenCalledWith('invoice', 'source-inv-id');
    expect(mockGet).toHaveBeenCalledWith('/v1/invoices/INV-ACTIVE/items');
    expect(mockPost).toHaveBeenCalledWith('/v1/credit-memos/invoice/INV-ACTIVE', {
      items: [{ invoiceItemId: 'target-item-1', amount: 100, skuName: 'SKU-A' }],
      comment: 'Promoted from source',
      reasonCode: 'Adjustment',
      effectiveDate: '2026-08-24',
    });
    const postedBody = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(postedBody).not.toHaveProperty('_zdf');
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('credit-memo', 'new-cm-id', 'push');
  });

  it('target not found: an explicit --invoice option is used as the source invoice id', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ creditMemoItems: [{ skuName: 'SKU-A', amount: 100 }] });
    mockReadByIdOrName.mockReturnValue({ _zdf: { sandbox: { id: 'target-inv-id', key: 'INV-ACTIVE' } } });
    mockGet.mockResolvedValue({ invoiceItems: [{ id: 'target-item-1', skuName: 'SKU-A', amount: 100 }] });
    mockPost.mockResolvedValue({ success: true, id: 'new-cm-id' });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001', '--invoice', 'explicit-inv-id']);

    expect(mockReadByIdOrName).toHaveBeenCalledWith('invoice', 'explicit-inv-id');
  });

  it('target not found: throws before any Zuora write when the source invoice cannot be determined', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ creditMemoItems: [{ skuName: 'SKU-A', amount: 100 }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001'])
    ).rejects.toThrow('exit');

    expect(mockReadByIdOrName).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('target not found: throws before any Zuora write when the source invoice file is not mapped into the active env', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ invoiceId: 'source-inv-id', creditMemoItems: [{ skuName: 'SKU-A', amount: 100 }] });
    mockReadByIdOrName.mockReturnValue({ _zdf: { otherEnv: { id: 'x', key: 'INV-OTHER' } } });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001'])
    ).rejects.toThrow('exit');

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('target not found: throws before any Zuora write when the source invoice file does not exist locally', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ invoiceId: 'source-inv-id', creditMemoItems: [{ skuName: 'SKU-A', amount: 100 }] });
    mockReadByIdOrName.mockReturnValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001'])
    ).rejects.toThrow('exit');

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('target not found: throws and makes no Zuora write when a memo item cannot be matched on the target invoice', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({
      invoiceId: 'source-inv-id',
      creditMemoItems: [{ skuName: 'SKU-A', amount: 100 }],
    });
    mockReadByIdOrName.mockReturnValue({ _zdf: { sandbox: { id: 'x', key: 'INV-ACTIVE' } } });
    mockGet.mockResolvedValue({ invoiceItems: [{ id: 'target-item-1', skuName: 'SKU-B', amount: 999 }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001'])
    ).rejects.toThrow('exit');

    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('target not found (create branch): deletes the stale source file when the created memo is assigned a DIFFERENT memoNumber than the source', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    const sourceRecord = {
      memoNumber: 'CM-001',
      invoiceId: 'source-inv-id',
      creditMemoItems: [{ invoiceItemId: 'source-item-1', skuName: 'SKU-A', amount: 100 }],
    };
    mockRead.mockImplementation((_resource: string, arg: string) => {
      if (arg === 'CM-001') return sourceRecord;
      if (arg === 'new-cm-id') return { memoNumber: 'CM-999' };
      return undefined;
    });
    mockReadByIdOrName.mockReturnValue({ _zdf: { sandbox: { id: 'target-inv-internal-id', key: 'INV-ACTIVE' } } });
    mockGet.mockResolvedValue({ invoiceItems: [{ id: 'target-item-1', skuName: 'SKU-A', amount: 100 }] });
    mockPost.mockResolvedValue({ success: true, id: 'new-cm-id' });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001']);

    expect(mockDeleteFile).toHaveBeenCalledWith('credit-memo', 'CM-001');
  });

  it('target not found (create branch): does NOT delete the source file when the created memo keeps the same memoNumber', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    const sourceRecord = {
      memoNumber: 'CM-001',
      invoiceId: 'source-inv-id',
      creditMemoItems: [{ invoiceItemId: 'source-item-1', skuName: 'SKU-A', amount: 100 }],
    };
    mockRead.mockImplementation((_resource: string, arg: string) => {
      if (arg === 'CM-001') return sourceRecord;
      if (arg === 'new-cm-id') return { memoNumber: 'CM-001' };
      return undefined;
    });
    mockReadByIdOrName.mockReturnValue({ _zdf: { sandbox: { id: 'target-inv-internal-id', key: 'INV-ACTIVE' } } });
    mockGet.mockResolvedValue({ invoiceItems: [{ id: 'target-item-1', skuName: 'SKU-A', amount: 100 }] });
    mockPost.mockResolvedValue({ success: true, id: 'new-cm-id' });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-001']);

    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});

describe('zdf delete credit-memo', () => {
  it('Draft memo: cancels BEFORE deleting, then resolveAndSync', async () => {
    const callOrder: string[] = [];
    mockGet.mockResolvedValue({ success: true, status: 'Draft' });
    mockPut.mockImplementation(async () => { callOrder.push('cancel'); return { success: true }; });
    mockDelete.mockImplementation(async () => { callOrder.push('delete'); return { success: true }; });
    mockResolve.mockImplementation(async () => { callOrder.push('resolve'); });
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'credit-memo', 'CM-001']);
    expect(mockGet).toHaveBeenCalledWith('/v1/credit-memos/CM-001');
    expect(mockPut).toHaveBeenCalledWith('/v1/credit-memos/CM-001/cancel', {});
    expect(mockDelete).toHaveBeenCalledWith('/v1/credit-memos/CM-001');
    expect(mockResolve).toHaveBeenCalledWith('credit-memo', 'CM-001', 'delete');
    // Order is the contract: cancel must precede delete.
    expect(callOrder).toEqual(['cancel', 'delete', 'resolve']);
  });

  it('Canceled memo: deletes directly without cancelling', async () => {
    mockGet.mockResolvedValue({ success: true, status: 'Canceled' });
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'credit-memo', 'CM-001']);
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('/v1/credit-memos/CM-001');
  });

  it('Posted memo: rejects up front, never cancels or deletes', async () => {
    mockGet.mockResolvedValue({ success: true, status: 'Posted' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'credit-memo', 'CM-001'])
    ).rejects.toThrow('exit');
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('unexpected status (e.g. Error / in-progress): rejected, never cancels or deletes', async () => {
    mockGet.mockResolvedValue({ success: true, status: 'Error' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'credit-memo', 'CM-001'])
    ).rejects.toThrow('exit');
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
