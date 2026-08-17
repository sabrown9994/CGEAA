import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: vi.fn(), apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: vi.fn(), setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: vi.fn(), readResourceFile: mockRead, renameResourceFile: mockRename, deleteResourceFile: vi.fn(), resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT'), }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

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

const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: mockReadFileSync };
});

import { register } from '../../commands/products.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull product', () => {
  it('calls resolveAndSync with pull action and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'product', 'prod-001']);
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'product', 'prod-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

const COMMERCE_PRODUCT_BODY = {
  name: 'TEST ZDF POC Commerce Product',
  start_date: '2026-08-01', end_date: '2050-12-31', category: 'base',
  custom_fields: { item__c: 'Inventory Assessment Tools', productfamily__c: 'Inventory' },
  plans: [{
    name: 'TEST ZDF POC Plan', start_date: '2026-08-01', end_date: '2050-12-31',
    active_currencies: ['USD'],
    charges: [{
      name: 'TEST ZDF POC Monthly Fee', charge_type: 'recurring', charge_model: 'flat_fee',
      trigger_event: 'contract_effective', end_date_condition: 'subscription_end',
      bill_cycle: { type: 'specific_day_of_month', period: 'bill_cycle_period_month', period_alignment: 'align_to_charge', day_of_month: 1 },
      pricing: { flatAmounts: { USD: 10 } },
      accounting: {
        accounting_code: 'Deferred Revenue', deferred_revenue_account: 'Deferred Revenue',
        recognized_revenue_account: 'Subscription Revenue: Inventory Insights',
        unbilled_receivables_account: 'Unbilled Accounts Receivable',
        contract_asset_account: 'Unbilled Accounts Receivable', contract_liability_account: 'Deferred Revenue',
        contract_recognized_revenue_account: 'Subscription Revenue: Inventory Insights',
        adjustment_liability_account: 'Customer Deposits', adjustment_revenue_account: 'Subscription Revenue: Inventory Insights',
      },
      custom_fields: { pobidentifier__c: 'Automatically Provisioned Service – Daily Ratable', pobname__c: 'Listing' },
    }],
  }],
};

describe('zdf create product', () => {
  it('posts the file body verbatim to /commerce/products and renames the file to the returned id', async () => {
    mockRead.mockReturnValue(COMMERCE_PRODUCT_BODY);
    mockPost.mockResolvedValue({ id: 'prod-commerce-001', name: COMMERCE_PRODUCT_BODY.name, state: 'product_active', plans: [] });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product']);
    expect(mockPost).toHaveBeenCalledWith('/commerce/products', COMMERCE_PRODUCT_BODY);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toHaveProperty('custom_fields');
    expect((body.plans as Array<Record<string, unknown>>)[0].charges).toEqual(COMMERCE_PRODUCT_BODY.plans[0].charges);
    expect(mockRename).toHaveBeenCalledWith('product', 'my-product', 'prod-commerce-001');
  });

  it('skips rename when --file is passed', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(COMMERCE_PRODUCT_BODY));
    mockPost.mockResolvedValue({ id: 'prod-commerce-002', state: 'product_active' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product', '--file', '/tmp/my-product.json']);
    expect(mockPost).toHaveBeenCalledWith('/commerce/products', COMMERCE_PRODUCT_BODY);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('throws when the response is missing an id', async () => {
    mockRead.mockReturnValue(COMMERCE_PRODUCT_BODY);
    mockPost.mockResolvedValue({ state: 'product_active' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('throws and exits non-zero when Zuora returns success:false', async () => {
    mockRead.mockReturnValue(COMMERCE_PRODUCT_BODY);
    mockPost.mockResolvedValue({ success: false, reasons: [{ code: 'INVALID_VALUE', message: 'Missing accounting code' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf push product', () => {
  it('reads file, filters to updatable fields, puts to object endpoint, calls resolveAndSync', async () => {
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001', CreatedById: 'readonly', AllowFeatureChanges: true });
    mockPut.mockResolvedValue({ Success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/object/product/prod-001', expect.objectContaining({ Name: 'Test Product', SKU: 'SKU-001', AllowFeatureChanges: true }));
    // CreatedById is not in allowlist — should be filtered out
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('CreatedById');
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'push');
  });

  it('exits with error when Zuora returns Success false', async () => {
    mockRead.mockReturnValue({ Name: 'Test Product' });
    mockPut.mockResolvedValue({ Success: false, Errors: [{ Code: 'MISSING_REQUIRED_VALUE', Message: 'Missing Item__c' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf delete product', () => {
  it('calls delete endpoint and resolveAndSync with delete action', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'product', 'prod-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/object/product/prod-001');
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'delete');
  });
});
