import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn() }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT') }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
}));

import { register } from '../../commands/orders.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull order', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'order', 'O-00000001']);
    expect(mockResolve).toHaveBeenCalledWith('order', 'O-00000001', 'pull');
  });
});

describe('zdf pull order-line-item', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'order-line-item', 'li-uuid-1']);
    expect(mockResolve).toHaveBeenCalledWith('order-line-item', 'li-uuid-1', 'pull');
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

  it('--account <id> adds accountId=<id> to the requested URL', async () => {
    mockGet.mockResolvedValueOnce({ orders: [] });
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'orders', '--account', 'ACC-123']);
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('accountId=ACC-123'));
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
