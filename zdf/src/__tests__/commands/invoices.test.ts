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

// resolveTargetId is mocked per-test (drives the push upsert branch); crossTenantKeyValue is kept
// real (pure) — mirrors accounts.test.ts / products.test.ts.
const mockResolveTargetId = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/upsert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../helpers/upsert.js')>();
  return { ...actual, resolveTargetId: mockResolveTargetId };
});

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
    // NOTE: passed by reference — the command mutates this object in place (records _zdf onto it
    // before writing it back), so the POST assertion below compares against a literal shape rather
    // than this `body` reference (which no longer reflects its pre-create state by the time the
    // assertion runs).
    const body = { accountNumber: 'A00000001', invoiceDate: '2026-08-18', invoiceItems: [{ amount: 10 }] };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'INV-1' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice']);
    expect(mockPost).toHaveBeenCalledWith('/v1/invoices', {
      accountNumber: 'A00000001', invoiceDate: '2026-08-18', invoiceItems: [{ amount: 10 }],
    });
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

  it('the body posted to Zuora never carries a _zdf map (create off a file that was previously pulled)', async () => {
    const body = {
      accountNumber: 'A00000001',
      invoiceDate: '2026-08-18',
      invoiceItems: [{ amount: 10 }],
      _zdf: { sandbox: { id: 'old-id', key: 'OLD-1' } },
    };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'INV-1' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice']);
    const postedBody = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(postedBody).not.toHaveProperty('_zdf');
  });

  it('records _zdf[<env>] on the written file after create, before renaming', async () => {
    const body = { accountNumber: 'A00000001', invoiceDate: '2026-08-18', invoiceItems: [{ amount: 10 }] };
    mockRead.mockReturnValue(body);
    mockPost.mockResolvedValue({ success: true, id: 'INV-1' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'invoice', 'my-invoice']);
    expect(mockWrite).toHaveBeenCalledWith('invoice', 'my-invoice', expect.objectContaining({
      _zdf: { sandbox: { id: 'INV-1', key: null } },
    }));
    expect(mockRename).toHaveBeenCalledWith('invoice', 'my-invoice', 'INV-1');
  });
});

describe('zdf push invoice', () => {
  beforeEach(() => {
    // Default: the sibling account is already mapped into the active env with a DIFFERENT key
    // than its source accountNumber, so the remap has a visible effect unless a test overrides it.
    mockReadByIdOrName.mockReturnValue({ _zdf: { sandbox: { id: 'acct-active-id', key: 'A-ACTIVE' } } });
  });

  it('target found: PUTs the RESOLVED id and calls resolveAndSync', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'resolved-inv-id', found: true });
    mockRead.mockReturnValue({
      invoiceNumber: 'INV-001',
      accountNumber: 'A-SOURCE',
      autoPay: true,
      comments: 'hi',
    });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    expect(mockPut).toHaveBeenCalledWith('/v1/invoices/resolved-inv-id', { autoPay: true, comments: 'hi' });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'resolved-inv-id', 'push');
  });

  it('target found: does NOT check/require a sibling account file at all — accountNumber is not updatable, so no remap is needed on this branch', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'resolved-inv-id', found: true });
    mockRead.mockReturnValue({ invoiceNumber: 'INV-001', accountNumber: 'A-SOURCE', autoPay: true });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    expect(mockReadByIdOrName).not.toHaveBeenCalled();
    expect(mockPut).toHaveBeenCalledWith('/v1/invoices/resolved-inv-id', { autoPay: true });
  });

  it('target found: does NOT throw for a same-tenant push when there is no local account file at all (pull invoice does not pull the parent account)', async () => {
    mockReadByIdOrName.mockReturnValue(undefined);
    mockResolveTargetId.mockResolvedValue({ id: 'INV-001', found: true });
    mockRead.mockReturnValue({ invoiceNumber: 'INV-001', accountNumber: 'A-SOURCE', comments: 'trivial edit' });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001'])
    ).resolves.not.toThrow();

    expect(mockPut).toHaveBeenCalledWith('/v1/invoices/INV-001', { comments: 'trivial edit' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('target found: the body PUT to Zuora never carries a _zdf map', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'INV-001', found: true });
    mockRead.mockReturnValue({
      invoiceNumber: 'INV-001',
      accountNumber: 'A-SOURCE',
      autoPay: true,
      _zdf: { sandbox: { id: 'INV-001', key: 'INV-001' } },
    });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });

  it('target not found: attempts CREATE from the local file body, with accountNumber remapped to the active-env account key', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({
      accountNumber: 'A-SOURCE',
      invoiceDate: '2026-08-21',
      invoiceItems: [{ amount: 10 }],
    });
    mockPost.mockResolvedValue({ success: true, id: 'created-inv-id' });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    expect(mockPost).toHaveBeenCalledWith('/v1/invoices', {
      accountNumber: 'A-ACTIVE',
      invoiceDate: '2026-08-21',
      invoiceItems: [{ amount: 10 }],
    });
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'created-inv-id', 'push');
  });

  it('target not found: POSTs the full toInvoiceCreateBody adapter output for a realistic pulled fixture (accountId FK resolved via sibling account; item chargeAmount→amount), with item ids/read-only fields dropped', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    // A real pulled invoice references its account by accountId (source internal id) and has NO
    // accountNumber; its item line amount is exposed as chargeAmount (both live-verified).
    mockRead.mockReturnValue({
      id: 'stray-invoice-id',
      invoiceNumber: 'INV-001',
      status: 'Draft',
      accountId: 'acct-src-id',
      invoiceDate: '2026-08-21',
      invoiceItems: [
        {
          id: 'item-1',
          invoiceId: 'stray-invoice-id',
          chargeAmount: 42,
          serviceStartDate: '2026-08-21',
          serviceEndDate: '2026-09-20',
          chargeName: 'Base Fee',
          revenueRecognitionRuleName: 'Recognize upon invoicing',
          deferredRevenueAccountingCode: 'Deferred Rev',
          recognizedRevenueAccountingCode: 'Recognized Rev',
          taxAmount: 0,
        },
      ],
      _zdf: { sandbox: { id: 'stray-invoice-id', key: 'INV-001' } },
    });
    mockPost.mockResolvedValue({ success: true, id: 'created-inv-id' });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    // FK resolved by accountId against the sibling account file (default beforeEach → key A-ACTIVE)
    expect(mockReadByIdOrName).toHaveBeenCalledWith('account', 'acct-src-id');
    expect(mockPost).toHaveBeenCalledWith('/v1/invoices', {
      accountNumber: 'A-ACTIVE',
      invoiceDate: '2026-08-21',
      invoiceItems: [
        {
          amount: 42,
          serviceStartDate: '2026-08-21',
          serviceEndDate: '2026-09-20',
          chargeName: 'Base Fee',
          revenueRecognitionRuleName: 'Recognize upon invoicing',
          deferredRevenueAccountingCode: 'Deferred Rev',
          recognizedRevenueAccountingCode: 'Recognized Rev',
        },
      ],
    });
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('status');
    const item = (body.invoiceItems as Record<string, unknown>[])[0];
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('invoiceId');
    expect(item).not.toHaveProperty('taxAmount');
    expect(item).not.toHaveProperty('chargeAmount');
  });

  it('target not found: the body POSTed to Zuora never carries a _zdf map', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({
      accountNumber: 'A-SOURCE',
      invoiceItems: [{ amount: 10 }],
      _zdf: { sandbox: { id: 'stale-id', key: 'STALE1' } },
    });
    mockPost.mockResolvedValue({ success: true, id: 'created-inv-id' });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });

  it('does NOT remap when the active-env account key already matches the source accountNumber', async () => {
    mockReadByIdOrName.mockReturnValue({ _zdf: { sandbox: { id: 'acct-1', key: 'A-SOURCE' } } });
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ accountNumber: 'A-SOURCE', invoiceItems: [{ amount: 10 }] });
    mockPost.mockResolvedValue({ success: true, id: 'created-inv-id' });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    expect(mockPost).toHaveBeenCalledWith('/v1/invoices', { accountNumber: 'A-SOURCE', invoiceItems: [{ amount: 10 }] });
  });

  it('target not found: throws and makes no Zuora write when the sibling account file does not exist locally', async () => {
    mockReadByIdOrName.mockReturnValue(undefined);
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ accountNumber: 'A-SOURCE', invoiceItems: [{ amount: 10 }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001'])
    ).rejects.toThrow('exit');

    expect(mockPut).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('target not found: throws and makes no Zuora write when the sibling account file has no active-env entry', async () => {
    mockReadByIdOrName.mockReturnValue({ _zdf: { otherEnv: { id: 'acct-1', key: 'A-OTHER' } } });
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ accountNumber: 'A-SOURCE', invoiceItems: [{ amount: 10 }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001'])
    ).rejects.toThrow('exit');

    expect(mockPut).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('target not found (create branch): deletes the stale source file when the created invoice is assigned a DIFFERENT invoiceNumber than the source', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    const sourceRecord = { invoiceNumber: 'INV-001', accountNumber: 'A-SOURCE', invoiceItems: [{ amount: 10 }] };
    mockRead.mockImplementation((_resource: string, arg: string) => {
      if (arg === 'INV-001') return sourceRecord;
      if (arg === 'created-inv-id') return { invoiceNumber: 'INV-999', accountNumber: 'A-ACTIVE' };
      return undefined;
    });
    mockPost.mockResolvedValue({ success: true, id: 'created-inv-id' });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    expect(mockDeleteFile).toHaveBeenCalledWith('invoice', 'INV-001');
  });

  it('target not found (create branch): does NOT delete the source file when the created invoice keeps the same invoiceNumber', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    const sourceRecord = { invoiceNumber: 'INV-001', accountNumber: 'A-SOURCE', invoiceItems: [{ amount: 10 }] };
    mockRead.mockImplementation((_resource: string, arg: string) => {
      if (arg === 'INV-001') return sourceRecord;
      if (arg === 'created-inv-id') return { invoiceNumber: 'INV-001', accountNumber: 'A-ACTIVE' };
      return undefined;
    });
    mockPost.mockResolvedValue({ success: true, id: 'created-inv-id' });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);

    expect(mockDeleteFile).not.toHaveBeenCalled();
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
