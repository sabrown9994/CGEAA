import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockWrite = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiQuery: mockQuery, setDebug: vi.fn() }));
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, deleteResourceFile: mockDeleteFile }));
vi.mock('../../helpers/output.js', () => ({ output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import {
  resolveAndSync,
  MAX_TRAVERSAL_NODES,
  FETCH_ALL_ITEMS_MAX,
  setMaxTraversalNodes,
  setMaxItems,
} from '../../helpers/dependency-graph.js';
import { output } from '../../helpers/output.js';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => {
  setMaxTraversalNodes(MAX_TRAVERSAL_NODES);
  setMaxItems(FETCH_ALL_ITEMS_MAX);
});

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

  it('setMaxTraversalNodes overrides the ceiling so traversal stops at the overridden value', async () => {
    setMaxTraversalNodes(3);
    const contactIds = Array.from({ length: 20 }, (_, i) => ({ Id: `CON-${i}` }));
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/accounts/ACC-001') return { id: 'ACC-001', name: 'Acme', success: true };
      if (url.startsWith('/v1/contacts/')) {
        const id = url.replace('/v1/contacts/', '');
        return { id, accountId: 'ACC-001', success: true };
      }
      return {};
    });
    mockQuery.mockImplementation(async (zoql: string) => {
      if (zoql.includes('FROM Contact')) return contactIds;
      return [];
    });

    const visited = new Set<string>();
    await resolveAndSync('account', 'ACC-001', 'pull', visited);

    expect(visited.size).toBeLessThanOrEqual(3);
    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/3-node ceiling/);
  });

  it('setMaxTraversalNodes(Infinity) (the --no-caps behavior) does not stop traversal at the default ceiling', async () => {
    setMaxTraversalNodes(Infinity);
    const contactCount = MAX_TRAVERSAL_NODES + 50;
    const contactIds = Array.from({ length: contactCount }, (_, i) => ({ Id: `CON-${i}` }));
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/accounts/ACC-001') return { id: 'ACC-001', name: 'Acme', success: true };
      if (url.startsWith('/v1/contacts/')) {
        const id = url.replace('/v1/contacts/', '');
        return { id, accountId: 'ACC-001', success: true };
      }
      return {};
    });
    mockQuery.mockImplementation(async (zoql: string) => {
      if (zoql.includes('FROM Contact')) return contactIds;
      return [];
    });

    const visited = new Set<string>();
    await resolveAndSync('account', 'ACC-001', 'pull', visited);

    expect(visited.size).toBeGreaterThan(MAX_TRAVERSAL_NODES);
    const contactFetchCalls = mockGet.mock.calls.filter(([url]) => (url as string).startsWith('/v1/contacts/'));
    expect(contactFetchCalls.length).toBe(contactCount);
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

  it('setMaxItems overrides the cap so pagination stops at the overridden value', async () => {
    setMaxItems(2);
    const page = {
      invoiceItems: [{ id: 'ii-1' }, { id: 'ii-2' }],
      nextPage: '/v1/invoices/INV-003/items?page=2',
    };
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/invoices/INV-003') return { id: 'INV-003', accountId: 'ACC-001', success: true };
      if (url.startsWith('/v1/invoices/INV-003/items')) return page;
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('invoice', 'INV-003', 'pull', new Set(['account:ACC-001']));

    const itemsCalls = mockGet.mock.calls.filter(([url]) => (url as string).startsWith('/v1/invoices/INV-003/items'));
    expect(itemsCalls.length).toBe(1);
    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/2-item cap/);
  });

  it('setMaxItems(Infinity) (the --no-caps behavior) keeps paginating past the default item cap', async () => {
    setMaxItems(Infinity);
    let calls = 0;
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/invoices/INV-004') return { id: 'INV-004', accountId: 'ACC-001', success: true };
      if (url.startsWith('/v1/invoices/INV-004/items')) {
        calls += 1;
        const done = calls >= 6; // 6 pages * 1000 = 6000 items, past the 5000 default cap
        return {
          invoiceItems: Array.from({ length: 1000 }, (_, i) => ({ id: `ii-${calls}-${i}` })),
          nextPage: done ? undefined : `/v1/invoices/INV-004/items?page=${calls + 1}`,
        };
      }
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('invoice', 'INV-004', 'pull', new Set(['account:ACC-001']));

    expect(output.warn).not.toHaveBeenCalled();
    const written = mockWrite.mock.calls.find(([resource]) => resource === 'invoice')?.[2] as Record<string, unknown>;
    expect((written['invoiceItems'] as unknown[]).length).toBe(6000);
    expect((written['invoiceItems'] as unknown[]).length).toBeGreaterThan(FETCH_ALL_ITEMS_MAX);
  });
});

describe('rulesAccount order traversal uses the account NUMBER via subscriptionOwner', () => {
  it('resolves orders against /v1/orders/subscriptionOwner/{accountNumber}, not the internal id', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/accounts/ACC-INTERNAL-1') {
        return { id: 'ACC-INTERNAL-1', basicInfo: { id: 'ACC-INTERNAL-1', accountNumber: 'ACG00018042' }, success: true };
      }
      if (url === '/v1/orders/subscriptionOwner/ACG00018042') {
        return { orders: [{ orderNumber: 'O-001' }], success: true };
      }
      if (url === '/v1/orders/O-001') {
        return { id: 'O-001', orderNumber: 'O-001', success: true };
      }
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('account', 'ACC-INTERNAL-1', 'pull', new Set());

    // The internal id must never be used against the orders endpoint.
    const orderUrlCalls = mockGet.mock.calls.map(([url]) => url as string).filter((u) => u.includes('/v1/orders'));
    expect(orderUrlCalls).toContain('/v1/orders/subscriptionOwner/ACG00018042');
    expect(orderUrlCalls.every((u) => !u.includes('accountId=ACC-INTERNAL-1'))).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/v1/orders/O-001');
  });

  it('falls back to a top-level accountNumber field when basicInfo is absent', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/accounts/ACC-INTERNAL-2') {
        return { id: 'ACC-INTERNAL-2', accountNumber: 'ADM-00033408', success: true };
      }
      if (url === '/v1/orders/subscriptionOwner/ADM-00033408') {
        return { orders: [], success: true };
      }
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('account', 'ACC-INTERNAL-2', 'pull', new Set());

    expect(mockGet).toHaveBeenCalledWith('/v1/orders/subscriptionOwner/ADM-00033408');
  });

  it('skips order traversal (does not fall back to the internal id) when no account number is present', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/accounts/ACC-NO-NUMBER') {
        return { id: 'ACC-NO-NUMBER', success: true };
      }
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('account', 'ACC-NO-NUMBER', 'pull', new Set());

    const orderUrlCalls = mockGet.mock.calls.map(([url]) => url as string).filter((u) => u.includes('/v1/orders'));
    expect(orderUrlCalls).toHaveLength(0);
  });

  it('bounds order enumeration by FETCH_ALL_ITEMS_MAX via the subscriptionOwner endpoint', async () => {
    setMaxItems(2);
    const page = {
      orders: [{ orderNumber: 'O-1' }, { orderNumber: 'O-2' }],
      nextPage: '/v1/orders/subscriptionOwner/ACG00018042?page=2',
    };
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/accounts/ACC-INTERNAL-3') {
        return { id: 'ACC-INTERNAL-3', basicInfo: { accountNumber: 'ACG00018042' }, success: true };
      }
      if (url.startsWith('/v1/orders/subscriptionOwner/ACG00018042')) return page;
      if (url.startsWith('/v1/orders/O-')) return { id: 'ignored', success: true };
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('account', 'ACC-INTERNAL-3', 'pull', new Set());

    const subOwnerCalls = mockGet.mock.calls.filter(([url]) => (url as string).startsWith('/v1/orders/subscriptionOwner/'));
    expect(subOwnerCalls.length).toBe(1);
    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/2-item cap/);
  });
});

describe('rulesOrder — order envelope unwrapping', () => {
  it('resolves OLI children and account number from inside a WRAPPED order response', async () => {
    mockQuery.mockResolvedValue([]);
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/orders/O-01339581') {
        return {
          order: {
            orderNumber: 'O-01339581',
            orderLineItems: [{ id: 'x' }],
            existingAccountNumber: 'ACG00026522',
          },
          success: true,
        };
      }
      if (url === '/v1/accounts/ACG00026522') {
        return { basicInfo: { id: 'ACC-INTERNAL-9' }, success: true };
      }
      if (url === '/v1/order-line-items/x') {
        return { id: 'x', success: true };
      }
      return {};
    });

    await resolveAndSync('order', 'O-01339581', 'pull', new Set());

    // Account number was read from inside the envelope, not the (undefined) top level.
    expect(mockGet).toHaveBeenCalledWith('/v1/accounts/ACG00026522');
    // The OLI child was resolved.
    expect(mockGet).toHaveBeenCalledWith('/v1/order-line-items/x');
  });

  it('still resolves subscription orders with no envelope and no orderLineItems', async () => {
    mockQuery.mockResolvedValue([]);
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/orders/O-SUB-1') {
        return {
          orderNumber: 'O-SUB-1',
          existingAccountNumber: 'ACG00099999',
          subscriptions: [{ subscriptionNumber: 'SUB-001' }],
          success: true,
        };
      }
      if (url === '/v1/accounts/ACG00099999') {
        return { basicInfo: { id: 'ACC-INTERNAL-2' }, success: true };
      }
      if (url === '/v1/subscriptions/SUB-001') {
        return { id: 'SUB-001', success: true };
      }
      return {};
    });

    await resolveAndSync('order', 'O-SUB-1', 'pull', new Set());

    expect(mockGet).toHaveBeenCalledWith('/v1/accounts/ACG00099999');
    expect(mockGet).toHaveBeenCalledWith('/v1/subscriptions/SUB-001');
    // No OLI lookups were attempted since orderLineItems is absent.
    const oliCalls = mockGet.mock.calls.filter(([url]) => (url as string).startsWith('/v1/order-line-items/'));
    expect(oliCalls).toHaveLength(0);
  });
});

describe('rulesBillRun — child-lookup failures warn and continue instead of aborting the pull', () => {
  it('warns and continues when the Invoice ZOQL 400s (e.g. INVALID_TYPE on intQA)', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/bill-runs/BR-001') return { id: 'BR-001', accountId: 'ACC-001', billRunNumber: 'BR-NUM-001', success: true };
      if (url.startsWith('/v1/credit-memos?sourceId=')) return { creditMemos: [] };
      return {};
    });
    mockQuery.mockImplementation(async (zoql: string) => {
      if (zoql.includes('FROM Invoice')) throw Object.assign(new Error('invalid type specified: invoice'), { statusCode: 400 });
      return []; // DebitMemo lookup
    });

    // Must not throw — the whole pull would otherwise abort.
    await expect(resolveAndSync('bill-run', 'BR-001', 'pull', new Set(['account:ACC-001']))).resolves.toBeUndefined();

    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/invoices for bill-run BR-001/);
  });

  it('warns and continues when the credit-memo sourceId GET 400s', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/bill-runs/BR-002') return { id: 'BR-002', accountId: 'ACC-001', billRunNumber: 'BR-NUM-002', success: true };
      if (url.startsWith('/v1/credit-memos?sourceId=')) throw Object.assign(new Error('bad request'), { statusCode: 400 });
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await expect(resolveAndSync('bill-run', 'BR-002', 'pull', new Set(['account:ACC-001']))).resolves.toBeUndefined();

    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/credit-memos for bill-run BR-002/);
  });

  it('warns and continues when the DebitMemo ZOQL 400s, and still resolves the invoice lookup', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/bill-runs/BR-003') return { id: 'BR-003', accountId: 'ACC-001', billRunNumber: 'BR-NUM-003', success: true };
      if (url === '/v1/invoices/INV-001') return { id: 'INV-001', accountId: 'ACC-001', success: true };
      if (url.startsWith('/v1/invoices/INV-001/items')) return { invoiceItems: [] };
      if (url.startsWith('/v1/credit-memos?sourceId=')) return { creditMemos: [] };
      return {};
    });
    mockQuery.mockImplementation(async (zoql: string) => {
      if (zoql.includes('FROM Invoice')) return [{ Id: 'INV-001' }];
      if (zoql.includes('FROM DebitMemo')) throw Object.assign(new Error('invalid type specified: debitmemo'), { statusCode: 400 });
      return [];
    });

    await expect(resolveAndSync('bill-run', 'BR-003', 'pull', new Set(['account:ACC-001']))).resolves.toBeUndefined();

    expect(mockGet).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/debit-memos for bill-run BR-003/);
  });

  it('does not warn when all bill-run child lookups succeed', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/v1/bill-runs/BR-004') return { id: 'BR-004', accountId: 'ACC-001', billRunNumber: 'BR-NUM-004', success: true };
      if (url.startsWith('/v1/credit-memos?sourceId=')) return { creditMemos: [] };
      return {};
    });
    mockQuery.mockResolvedValue([]);

    await resolveAndSync('bill-run', 'BR-004', 'pull', new Set(['account:ACC-001']));

    expect(output.warn).not.toHaveBeenCalled();
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
