import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockWrite = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiQuery: mockQuery, setDebug: vi.fn() }));
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, deleteResourceFile: mockDeleteFile }));
vi.mock('../../helpers/output.js', () => ({ output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import { resolveAndSync, MAX_TRAVERSAL_NODES, FETCH_ALL_ITEMS_MAX } from '../../helpers/dependency-graph.js';
import { output } from '../../helpers/output.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('resolveAndSync visited-set loop prevention', () => {
  it('skips a resource+id pair already in the visited set', async () => {
    const visited = new Set(['account:ACC-001']);
    await resolveAndSync('account', 'ACC-001', 'pull', visited);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('resolveAndSync contact pull — no dependencies', () => {
  it('adds contact to visited set and fetches nothing else', async () => {
    mockGet.mockResolvedValue({ id: 'CON-001', accountId: 'ACC-001', success: true });
    const visited = new Set<string>();
    await resolveAndSync('contact', 'CON-001', 'pull', visited);
    expect(mockGet).toHaveBeenCalledWith('/v1/contacts/CON-001');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(visited.has('contact:CON-001')).toBe(true);
  });
});

describe('resolveAndSync contact push — re-fetches parent account', () => {
  it('fetches contact then re-fetches parent account', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'CON-001', accountId: 'ACC-001', success: true }) // contact
      .mockResolvedValueOnce({ id: 'ACC-001', name: 'Acme', success: true });          // account
    mockQuery.mockResolvedValue([]);
    await resolveAndSync('contact', 'CON-001', 'push', new Set());
    expect(mockGet).toHaveBeenNthCalledWith(1, '/v1/contacts/CON-001');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/accounts/ACC-001');
  });
});

describe('resolveAndSync subscription pull — embeds ratePlans inline', () => {
  it('writes subscription with ratePlans from Zuora response', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'SUB-001',
      accountId: 'ACC-001',
      ratePlans: [{ id: 'rp-1', ratePlanCharges: [{ id: 'rpc-1', name: 'Monthly Fee' }] }],
      success: true,
    });
    await resolveAndSync('subscription', 'SUB-001', 'pull', new Set(['account:ACC-001']));
    expect(mockWrite).toHaveBeenCalledWith('subscription', 'SUB-001', expect.objectContaining({
      ratePlans: [expect.objectContaining({ id: 'rp-1' })],
    }));
  });
});

describe('resolveAndSync credit-memo pull — embeds items from the "items" response key', () => {
  it('captures non-zero items and stores them under creditMemoItems', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'CM-001', accountId: 'ACC-001', success: true }) // credit-memo header
      .mockResolvedValueOnce({ items: [{ id: 'cmi-1', amount: 10 }, { id: 'cmi-2', amount: 5 }] }); // /items page
    await resolveAndSync('credit-memo', 'CM-001', 'pull', new Set(['account:ACC-001']));
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/credit-memos/CM-001/items');
    expect(mockWrite).toHaveBeenCalledWith('credit-memo', 'CM-001', expect.objectContaining({
      creditMemoItems: [
        expect.objectContaining({ id: 'cmi-1', amount: 10 }),
        expect.objectContaining({ id: 'cmi-2', amount: 5 }),
      ],
    }));
    const written = mockWrite.mock.calls[0][2];
    expect(written.creditMemoItems).toHaveLength(2);
  });
});

describe('resolveAndSync debit-memo pull — embeds items from the "items" response key', () => {
  it('captures non-zero items and stores them under debitMemoItems', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'DM-001', accountId: 'ACC-001', success: true }) // debit-memo header
      .mockResolvedValueOnce({ items: [{ id: 'dmi-1', amount: 20 }] }); // /items page
    await resolveAndSync('debit-memo', 'DM-001', 'pull', new Set(['account:ACC-001']));
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/debit-memos/DM-001/items');
    expect(mockWrite).toHaveBeenCalledWith('debit-memo', 'DM-001', expect.objectContaining({
      debitMemoItems: [expect.objectContaining({ id: 'dmi-1', amount: 20 })],
    }));
    const written = mockWrite.mock.calls[0][2];
    expect(written.debitMemoItems).toHaveLength(1);
  });
});

describe('resolveAndSync traversal ceiling', () => {
  it('stops traversing and warns once when a runaway pull would exceed MAX_TRAVERSAL_NODES', async () => {
    // Simulate an account with far more contacts than the ceiling allows, so the
    // account -> contact fan-out alone would blow past MAX_TRAVERSAL_NODES.
    const contactCount = MAX_TRAVERSAL_NODES + 50;
    const contactIds = Array.from({ length: contactCount }, (_, i) => ({ Id: `CON-${i}` }));

    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/accounts/ACC-001') return { id: 'ACC-001', name: 'Acme', success: true };
      if (url.startsWith('/v1/contacts/')) {
        const id = url.replace('/v1/contacts/', '');
        return { id, accountId: 'ACC-001', success: true };
      }
      // orders / subscriptions / invoices / credit-memos / debit-memos paginated lookups
      return {};
    });
    mockQuery.mockImplementation(async (zoql: string) => {
      if (zoql.includes('FROM Contact')) return contactIds;
      return []; // BillRun lookup
    });

    const visited = new Set<string>();
    await resolveAndSync('account', 'ACC-001', 'pull', visited);

    // Traversal stopped at the ceiling: visited never grows past MAX_TRAVERSAL_NODES,
    // and we did not fetch every contact (proves pagination/traversal actually halted).
    expect(visited.size).toBeLessThanOrEqual(MAX_TRAVERSAL_NODES);
    const contactFetchCalls = mockGet.mock.calls.filter(([url]) => (url as string).startsWith('/v1/contacts/'));
    expect(contactFetchCalls.length).toBeLessThan(contactCount);

    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/ceiling|--no-dependency/);
  });

  it('does not warn or cap traversal for a small account well under the ceiling', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'ACC-SMALL', name: 'Acme', success: true }) // account
      .mockResolvedValue({}); // orders/subs/invoices/creditmemos/debitmemos pages
    mockQuery.mockResolvedValue([]); // no contacts, no bill runs

    await resolveAndSync('account', 'ACC-SMALL', 'pull', new Set());

    expect(output.warn).not.toHaveBeenCalled();
  });
});

describe('fetchAllItems pagination cap', () => {
  it('stops following nextPage once the FETCH_ALL_ITEMS_MAX item cap is reached, warns once, and does not throw', async () => {
    // A single page already at the cap, but the server still claims there's a nextPage
    // (mirrors the real bug: /v1/orders ignoring its accountId filter and returning the
    // whole tenant's orders across endless pages).
    const bigPage = {
      invoiceItems: Array.from({ length: FETCH_ALL_ITEMS_MAX }, (_, i) => ({ id: `ii-${i}` })),
      nextPage: '/v1/invoices/INV-001/items?page=2',
    };
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/invoices/INV-001') return { id: 'INV-001', accountId: 'ACC-001', success: true };
      if (url.startsWith('/v1/invoices/INV-001/items')) return bigPage;
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('invoice', 'INV-001', 'pull', new Set(['account:ACC-001']));

    // Only one items page was fetched despite nextPage being present — the cap stopped pagination.
    const itemsCalls = mockGet.mock.calls.filter(([url]) => (url as string).startsWith('/v1/invoices/INV-001/items'));
    expect(itemsCalls.length).toBe(1);

    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/truncated|cap|--no-dependency/);

    const written = mockWrite.mock.calls.find(([resource]) => resource === 'invoice')?.[2] as Record<string, unknown>;
    expect((written['invoiceItems'] as unknown[]).length).toBe(FETCH_ALL_ITEMS_MAX);
  });

  it('does not warn or truncate for a normal small sub-item list', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/invoices/INV-002') return { id: 'INV-002', accountId: 'ACC-001', success: true };
      if (url.startsWith('/v1/invoices/INV-002/items')) return { invoiceItems: [{ id: 'ii-1' }, { id: 'ii-2' }] };
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('invoice', 'INV-002', 'pull', new Set(['account:ACC-001']));

    expect(output.warn).not.toHaveBeenCalled();
    const written = mockWrite.mock.calls.find(([resource]) => resource === 'invoice')?.[2] as Record<string, unknown>;
    expect((written['invoiceItems'] as unknown[]).length).toBe(2);
  });
});

describe('resolveAndSync read-response guard', () => {
  it('does not write when the body has a populated reasons array (200-with-error)', async () => {
    mockGet.mockResolvedValueOnce({
      success: false,
      reasons: [{ code: 58230015, message: 'Object not found.' }],
    });
    await resolveAndSync('account', 'ACC-BAD', 'pull', new Set());
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('does not write when the body has success:false and no reasons', async () => {
    mockGet.mockResolvedValueOnce({ success: false });
    await resolveAndSync('account', 'ACC-BAD', 'pull', new Set());
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('writes when the body has no success field and no errors (e.g. a workflow-shaped object)', async () => {
    mockGet.mockResolvedValueOnce({ id: 'CON-001', accountId: 'ACC-001' });
    await resolveAndSync('contact', 'CON-001', 'pull', new Set());
    expect(mockWrite).toHaveBeenCalledWith('contact', 'CON-001', expect.objectContaining({ id: 'CON-001' }));
  });

  it('writes when the body has a normal success:true field', async () => {
    mockGet.mockResolvedValueOnce({ id: 'CON-001', accountId: 'ACC-001', success: true });
    await resolveAndSync('contact', 'CON-001', 'pull', new Set());
    expect(mockWrite).toHaveBeenCalledWith('contact', 'CON-001', expect.objectContaining({ id: 'CON-001' }));
  });
});
