import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT') }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));
vi.mock('../../helpers/output.js', () => ({
  output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockResolve = vi.hoisted(() => vi.fn());
const mockGetMaxItems = vi.hoisted(() => vi.fn().mockReturnValue(5000));
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  getMaxItems: mockGetMaxItems,
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

import { register } from '../../commands/orders.js';
import { output } from '../../helpers/output.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMaxItems.mockReturnValue(5000);
});

describe('zdf pull order', () => {
  it('calls resolveAndSync with pull action and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'order', 'O-00000001']);
    expect(mockResolve).toHaveBeenCalledWith('order', 'O-00000001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'order', 'O-00000001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf pull order-line-item', () => {
  it('calls resolveAndSync with pull action and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'order-line-item', 'li-uuid-1']);
    expect(mockResolve).toHaveBeenCalledWith('order-line-item', 'li-uuid-1', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'order-line-item', 'li-uuid-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf list orders', () => {
  it('fetches all pages, writes orders and fetches order line item details when --all is passed', async () => {
    mockGet
      .mockResolvedValueOnce({
        orders: [{
          orderNumber: 'O-001',
          orderLineItems: [{ id: 'li-uuid-1' }],
        }],
        // no nextPage
      })
      .mockResolvedValueOnce({
        // second mockGet call = GET /v1/order-line-items/li-uuid-1
        success: true,
        orderLineItem: { id: 'li-uuid-1', itemName: 'Widget' },
      });
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--all']);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenNthCalledWith(1, expect.stringContaining('/v1/orders'));
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/order-line-items/li-uuid-1');
    expect(mockWrite).toHaveBeenCalledWith('order', 'O-001', expect.any(Object));
    expect(mockWrite).toHaveBeenCalledWith('order-line-item', 'li-uuid-1', expect.objectContaining({ id: 'li-uuid-1' }));
  });

  it('with no --limit, --account/--status filter, or --all: does not fetch, surfaces guidance, and exits non-zero', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'zdf', 'list', 'orders'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('--limit 5 stops after exactly 5 orders across pages', async () => {
    const makePage = (start: number) => ({
      orders: Array.from({ length: 3 }, (_, i) => ({ orderNumber: `O-${start + i}`, orderLineItems: [] })),
      nextPage: 'yes',
    });
    mockGet
      .mockResolvedValueOnce(makePage(1))
      .mockResolvedValueOnce(makePage(4));
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--limit', '5']);
    expect(mockWrite).toHaveBeenCalledTimes(5);
    // only 2 pages needed to reach 5 orders (3 + 3 = 6 >= 5), so pagination stops before a 3rd page
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('--limit 6 (exact multiple of page size) stops without fetching the next page', async () => {
    const makePage = (start: number) => ({
      orders: Array.from({ length: 3 }, (_, i) => ({ orderNumber: `O-${start + i}`, orderLineItems: [] })),
      nextPage: 'yes',
    });
    mockGet
      .mockResolvedValueOnce(makePage(1))
      .mockResolvedValueOnce(makePage(4));
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--limit', '6']);
    expect(mockWrite).toHaveBeenCalledTimes(6);
    // total reaches limit exactly at the end of the 2nd page; the 3rd page must NOT be fetched
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('--account <key> issues GET to /v1/orders/subscriptionOwner/<key>', async () => {
    mockGet.mockResolvedValueOnce({ orders: [] });
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--account', 'ACG00018042']);
    expect(mockGet).toHaveBeenCalledWith('/v1/orders/subscriptionOwner/ACG00018042?page=1&pageSize=50');
  });

  it('--account <key> URL-encodes the key', async () => {
    mockGet.mockResolvedValueOnce({ orders: [] });
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--account', 'ADM-00033408']);
    expect(mockGet).toHaveBeenCalledWith(`/v1/orders/subscriptionOwner/${encodeURIComponent('ADM-00033408')}?page=1&pageSize=50`);
  });

  it('--account + --limit N stops after exactly N orders fetched via subscriptionOwner', async () => {
    mockGet.mockResolvedValueOnce({
      orders: Array.from({ length: 5 }, (_, i) => ({ orderNumber: `O-${i}`, orderLineItems: [] })),
      // no nextPage
    });
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--account', 'ACG00018042', '--limit', '3']);
    expect(mockGet).toHaveBeenCalledWith('/v1/orders/subscriptionOwner/ACG00018042?page=1&pageSize=50');
    expect(mockWrite).toHaveBeenCalledTimes(3);
  });

  it('--account + --status filters orders client-side (status is not sent as a query param to subscriptionOwner)', async () => {
    mockGet.mockResolvedValueOnce({
      orders: [
        { orderNumber: 'O-1', status: 'Completed', orderLineItems: [] },
        { orderNumber: 'O-2', status: 'Draft', orderLineItems: [] },
      ],
    });
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--account', 'ACG00018042', '--status', 'Completed']);
    expect(mockGet).toHaveBeenCalledWith('/v1/orders/subscriptionOwner/ACG00018042?page=1&pageSize=50');
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('order', 'O-1', expect.objectContaining({ status: 'Completed' }));
  });

  it('--status without --account still sends status= as a query param to the generic endpoint', async () => {
    mockGet.mockResolvedValueOnce({ orders: [] });
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--status', 'Draft']);
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('status=Draft'));
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/orders?'));
  });

  it('bounds per-order-line-item fetches by the effective --max-items cap, warns once, and does not throw', async () => {
    // A single order with more line items than the (overridden, small) cap allows, so the
    // per-item GET loop would otherwise issue unbounded serial GETs.
    mockGetMaxItems.mockReturnValue(2);
    mockGet
      .mockResolvedValueOnce({
        orders: [{
          orderNumber: 'O-BIG',
          orderLineItems: Array.from({ length: 5 }, (_, i) => ({ id: `li-${i}` })),
        }],
        // no nextPage
      })
      .mockResolvedValue({ success: true, orderLineItem: { id: 'li-x' } });

    await expect(makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--all'])).resolves.not.toThrow();

    // Order page fetch (1) + exactly 2 line-item GETs (the cap) = 3 total.
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/order-line-items/li-0');
    expect(mockGet).toHaveBeenNthCalledWith(3, '/v1/order-line-items/li-1');
    expect(output.warn).toHaveBeenCalledTimes(1);
    expect((output.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/2-item cap/);
    // The order itself is still written even though its line items were truncated.
    expect(mockWrite).toHaveBeenCalledWith('order', 'O-BIG', expect.any(Object));
  });

  it('does not warn or cap for a normal order with few line items', async () => {
    mockGet
      .mockResolvedValueOnce({
        orders: [{ orderNumber: 'O-SMALL', orderLineItems: [{ id: 'li-1' }, { id: 'li-2' }] }],
      })
      .mockResolvedValue({ success: true, orderLineItem: { id: 'li-x' } });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--all']);

    expect(output.warn).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledTimes(3); // 1 page + 2 line items
  });
});

describe('zdf create order', () => {
  it('reads local file, posts to Zuora, renames file to order number', async () => {
    mockRead.mockReturnValue({ orderDate: '2026-01-01', existingAccountNumber: 'ACG001' });
    mockPost.mockResolvedValue({ success: true, orderNumber: 'O-00000001' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'order', 'my-order']);
    expect(mockPost).toHaveBeenCalledWith('/v1/orders', expect.any(Object));
    expect(mockRename).toHaveBeenCalledWith('order', 'my-order', 'O-00000001');
  });
});

describe('zdf push order', () => {
  it('reads local file, puts to Zuora, and calls resolveAndSync with push action', async () => {
    mockRead.mockReturnValue({ orderDate: '2026-01-01', status: 'Draft' });
    mockPut.mockResolvedValue({ success: true, orderNumber: 'O-00000001' });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'order', 'O-00000001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/orders/O-00000001', expect.any(Object));
    expect(mockResolve).toHaveBeenCalledWith('order', 'O-00000001', 'push');
  });
});

describe('zdf delete order', () => {
  it('calls delete endpoint and resolveAndSync with delete action', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'order', 'O-00000001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/orders/O-00000001');
    expect(mockResolve).toHaveBeenCalledWith('order', 'O-00000001', 'delete');
  });
});

describe('zdf push order-line-item', () => {
  it('reads local file, filters to updatable fields, puts to Zuora, and calls resolveAndSync', async () => {
    mockRead.mockReturnValue({ itemName: 'Widget', quantity: 2, id: 'li-uuid-1' });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'order-line-item', 'li-uuid-1']);
    expect(mockPut).toHaveBeenCalledWith(
      '/v1/order-line-items/li-uuid-1',
      expect.objectContaining({ itemName: 'Widget', quantity: 2 })
    );
    // id should be filtered out (not in updatable fields)
    const callArg = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('id');
    expect(mockResolve).toHaveBeenCalledWith('order-line-item', 'li-uuid-1', 'push');
  });
});
