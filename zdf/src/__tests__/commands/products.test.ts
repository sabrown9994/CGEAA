import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: vi.fn(), apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: vi.fn(), setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, deleteResourceFile: mockDeleteFile, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT'), }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

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

// resolveTargetId is mocked per-test (drives the push upsert branch); crossTenantKeyValue is kept
// real (pure) so the _zdf key stored on write matches production behavior.
const mockResolveTargetId = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/upsert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../helpers/upsert.js')>();
  return { ...actual, resolveTargetId: mockResolveTargetId };
});

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

function commerceProductBody() {
  return {
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
}

// A fresh object literal per call — the create/push commands mutate the file record in place
// (setEnvEntry) when storing the _zdf map, so tests must not share one mutable fixture object
// across assertions/tests.
const COMMERCE_PRODUCT_BODY = commerceProductBody();

describe('zdf create product', () => {
  it('posts the file body verbatim to /commerce/products and renames the file to the returned id', async () => {
    mockRead.mockReturnValue(commerceProductBody());
    mockPost.mockResolvedValue({ id: 'prod-commerce-001', name: COMMERCE_PRODUCT_BODY.name, state: 'product_active', plans: [] });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product']);
    expect(mockPost).toHaveBeenCalledWith('/commerce/products', COMMERCE_PRODUCT_BODY);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toHaveProperty('custom_fields');
    expect((body.plans as Array<Record<string, unknown>>)[0].charges).toEqual(COMMERCE_PRODUCT_BODY.plans[0].charges);
    expect(mockRename).toHaveBeenCalledWith('product', 'my-product', 'prod-commerce-001');
  });

  it('stores _zdf[<env>] from the create response and writes the file back before renaming', async () => {
    mockRead.mockReturnValue(commerceProductBody());
    mockPost.mockResolvedValue({ id: 'prod-commerce-001', name: COMMERCE_PRODUCT_BODY.name, state: 'product_active' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product']);
    expect(mockWrite).toHaveBeenCalledWith('product', 'my-product', expect.objectContaining({
      _zdf: { sandbox: { id: 'prod-commerce-001', key: null } },
    }));
  });

  it('skips rename when --file is passed', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(commerceProductBody()));
    mockPost.mockResolvedValue({ id: 'prod-commerce-002', state: 'product_active' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product', '--file', '/tmp/my-product.json']);
    expect(mockPost).toHaveBeenCalledWith('/commerce/products', COMMERCE_PRODUCT_BODY);
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('throws when the response is missing an id', async () => {
    mockRead.mockReturnValue(commerceProductBody());
    mockPost.mockResolvedValue({ state: 'product_active' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('throws and exits non-zero when Zuora returns success:false', async () => {
    mockRead.mockReturnValue(commerceProductBody());
    mockPost.mockResolvedValue({ success: false, reasons: [{ code: 'INVALID_VALUE', message: 'Missing accounting code' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('the body posted to Zuora never carries a _zdf map', async () => {
    mockRead.mockReturnValue({ ...commerceProductBody(), _zdf: { sandbox: { id: 'old-id', key: 'OLD-SKU' } } });
    mockPost.mockResolvedValue({ id: 'prod-commerce-001', state: 'product_active' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product']);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });
});

describe('zdf push product', () => {
  it('target found: filters to updatable fields, PUTs to the object endpoint using the RESOLVED id, calls resolveAndSync', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'prod-001', found: true });
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001', CreatedById: 'readonly', AllowFeatureChanges: true });
    mockPut.mockResolvedValue({ Success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/object/product/prod-001', expect.objectContaining({ Name: 'Test Product', SKU: 'SKU-001', AllowFeatureChanges: true }));
    // CreatedById is not in allowlist — should be filtered out
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('CreatedById');
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'push');
  });

  it('target found: does NOT write the file directly — resolveAndSync (mocked here) is the sole writer', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'prod-001', found: true });
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001' });
    mockPut.mockResolvedValue({ Success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    // The command itself must not write the file — resolveAndSync's own re-fetch-and-write is
    // what populates _zdf (merged with other envs — see dependency-graph.test.ts). product has
    // no natural-key filename, so a second explicit write here would risk diverging from
    // resolveAndSync's write whenever the resolved id differs from the CLI arg (Finding 2).
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'push');
  });

  it('target found, resolved id SAME as the CLI arg: single write, no stale-file cleanup needed', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'prod-001', found: true });
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001' });
    mockPut.mockResolvedValue({ Success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('target found, resolved id differs from the CLI arg: PUTs and syncs using the resolved id, not the arg, and deletes the now-stale arg-keyed file', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'resolved-id', found: true });
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001' });
    mockPut.mockResolvedValue({ Success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/object/product/resolved-id', expect.objectContaining({ SKU: 'SKU-001' }));
    expect(mockResolve).toHaveBeenCalledWith('product', 'resolved-id', 'push');
    // Only ONE file should remain on disk for this product — the stale arg-keyed one (product
    // has no natural-key filename, so it wouldn't otherwise get cleaned up / reconciled later).
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockDeleteFile).toHaveBeenCalledWith('product', 'prod-001');
  });

  it('target not found: attempts CREATE via the Commerce API from the local file body instead of PUT', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue(commerceProductBody());
    mockPost.mockResolvedValue({ id: 'prod-commerce-003', state: 'product_active' });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    expect(mockPost).toHaveBeenCalledWith('/commerce/products', COMMERCE_PRODUCT_BODY);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('target not found: does NOT write the file directly — resolveAndSync (mocked here) re-fetches/writes by the CREATED id, and the stale arg-keyed file is deleted', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue(commerceProductBody());
    mockPost.mockResolvedValue({ id: 'prod-commerce-003', state: 'product_active' });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-commerce-003', 'push');
    expect(mockDeleteFile).toHaveBeenCalledWith('product', 'prod-001');
  });

  it('the body PUT to Zuora on the update path never carries a _zdf map', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'prod-001', found: true });
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001', _zdf: { sandbox: { id: 'prod-001', key: 'SKU-001' } } });
    mockPut.mockResolvedValue({ Success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });

  it('the body POSTed to Zuora on the create-fallback path never carries a _zdf map', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ ...commerceProductBody(), _zdf: { sandbox: { id: 'stale-id', key: 'STALE-SKU' } } });
    mockPost.mockResolvedValue({ id: 'prod-commerce-003', state: 'product_active' });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });

  it('exits with error when Zuora returns Success false', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'prod-001', found: true });
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
