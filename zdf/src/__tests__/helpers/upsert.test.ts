import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApiGet = vi.hoisted(() => vi.fn());
const mockApiQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({
  apiGet: mockApiGet,
  apiQuery: mockApiQuery,
}));

const mockGetActiveEnv = vi.hoisted(() => vi.fn());
vi.mock('../../auth/config.js', () => ({ getActiveEnv: mockGetActiveEnv }));

import { crossTenantKeyValue, searchByKey, verifyId, resolveTargetId, matchInvoiceItems } from '../../helpers/upsert.js';

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiQuery.mockReset();
  mockGetActiveEnv.mockReset();
  mockGetActiveEnv.mockReturnValue({ name: 'intQA', isProduction: false });
});

describe('crossTenantKeyValue', () => {
  it('account: reads basicInfo.accountNumber', () => {
    expect(crossTenantKeyValue('account', { basicInfo: { accountNumber: 'A-001' } })).toBe('A-001');
  });

  it('account: falls back to top-level accountNumber when basicInfo missing', () => {
    expect(crossTenantKeyValue('account', { accountNumber: 'A-002' })).toBe('A-002');
  });

  it('account: returns undefined when both are blank/missing', () => {
    expect(crossTenantKeyValue('account', {})).toBeUndefined();
    expect(crossTenantKeyValue('account', { accountNumber: '   ' })).toBeUndefined();
  });

  it('product: reads SKU (PascalCase) first', () => {
    expect(crossTenantKeyValue('product', { SKU: 'SKU-1', sku: 'sku-lower' })).toBe('SKU-1');
  });

  it('product: falls back to lowercase sku', () => {
    expect(crossTenantKeyValue('product', { sku: 'sku-lower' })).toBe('sku-lower');
  });

  it('product: returns undefined when missing', () => {
    expect(crossTenantKeyValue('product', {})).toBeUndefined();
  });

  it('invoice: reads invoiceNumber', () => {
    expect(crossTenantKeyValue('invoice', { invoiceNumber: 'INV-1' })).toBe('INV-1');
  });

  it('invoice: returns undefined when blank', () => {
    expect(crossTenantKeyValue('invoice', { invoiceNumber: '' })).toBeUndefined();
  });

  it('credit-memo: reads memoNumber first, falls back to number', () => {
    expect(crossTenantKeyValue('credit-memo', { memoNumber: 'CM-1', number: 'ignored' })).toBe('CM-1');
    expect(crossTenantKeyValue('credit-memo', { number: 'CM-2' })).toBe('CM-2');
    expect(crossTenantKeyValue('credit-memo', {})).toBeUndefined();
  });

  it('debit-memo: reads memoNumber first, falls back to number', () => {
    expect(crossTenantKeyValue('debit-memo', { memoNumber: 'DM-1', number: 'ignored' })).toBe('DM-1');
    expect(crossTenantKeyValue('debit-memo', { number: 'DM-2' })).toBe('DM-2');
    expect(crossTenantKeyValue('debit-memo', {})).toBeUndefined();
  });

  it('bill-run: reads billRunNumber, then number, then name', () => {
    expect(crossTenantKeyValue('bill-run', { billRunNumber: 'BR-1', number: 'x', name: 'y' })).toBe('BR-1');
    expect(crossTenantKeyValue('bill-run', { number: 'BR-2', name: 'y' })).toBe('BR-2');
    expect(crossTenantKeyValue('bill-run', { name: 'BR-3' })).toBe('BR-3');
    expect(crossTenantKeyValue('bill-run', {})).toBeUndefined();
  });

  it('returns undefined for an unknown resource', () => {
    expect(crossTenantKeyValue('subscription', { subscriptionNumber: 'S-1' })).toBeUndefined();
  });

  it('trims whitespace-padded values', () => {
    expect(crossTenantKeyValue('invoice', { invoiceNumber: '  INV-9  ' })).toBe('INV-9');
  });
});

describe('searchByKey', () => {
  it('returns the id when exactly one row matches', async () => {
    mockApiQuery.mockResolvedValue([{ Id: 'zuora-id-1' }]);
    const id = await searchByKey('account', 'A-001');
    expect(id).toBe('zuora-id-1');
    expect(mockApiQuery).toHaveBeenCalledWith(
      "SELECT Id FROM Account WHERE AccountNumber = 'A-001'"
    );
  });

  it('returns undefined when 0 rows match', async () => {
    mockApiQuery.mockResolvedValue([]);
    expect(await searchByKey('account', 'A-404')).toBeUndefined();
  });

  it('returns undefined when more than 1 row matches (ambiguous)', async () => {
    mockApiQuery.mockResolvedValue([{ Id: 'a' }, { Id: 'b' }]);
    expect(await searchByKey('account', 'A-dup')).toBeUndefined();
  });

  it('escapes single quotes in the key by doubling them', async () => {
    mockApiQuery.mockResolvedValue([{ Id: 'zuora-id-2' }]);
    await searchByKey('product', "O'Brien SKU");
    expect(mockApiQuery).toHaveBeenCalledWith(
      "SELECT Id FROM Product WHERE SKU = 'O''Brien SKU'"
    );
  });

  it('uses the correct zoqlObject/zoqlKeyField per resource', async () => {
    mockApiQuery.mockResolvedValue([{ Id: 'x' }]);
    await searchByKey('bill-run', 'BR-1');
    expect(mockApiQuery).toHaveBeenCalledWith(
      "SELECT Id FROM BillRun WHERE BillRunNumber = 'BR-1'"
    );
  });
});

describe('verifyId', () => {
  it('returns true on a successful GET', async () => {
    mockApiGet.mockResolvedValue({ id: 'x', success: true });
    expect(await verifyId('account', 'x')).toBe(true);
  });

  it('returns true when the response has no success field at all', async () => {
    mockApiGet.mockResolvedValue({ id: 'x' });
    expect(await verifyId('product', 'x')).toBe(true);
  });

  it('returns false when the GET throws', async () => {
    mockApiGet.mockRejectedValue(new Error('404'));
    expect(await verifyId('account', 'missing')).toBe(false);
  });

  it('returns false when the body has success: false', async () => {
    mockApiGet.mockResolvedValue({ success: false, reasons: [{ code: 60, message: 'not found' }] });
    expect(await verifyId('invoice', 'missing')).toBe(false);
  });

  it('returns false when the body has a populated errors array (no success field)', async () => {
    mockApiGet.mockResolvedValue({ errors: [{ code: 'X', message: 'nope' }] });
    expect(await verifyId('credit-memo', 'missing')).toBe(false);
  });

  it('calls the correct GET endpoint per resource', async () => {
    mockApiGet.mockResolvedValue({ success: true });
    await verifyId('debit-memo', 'dm-1');
    expect(mockApiGet).toHaveBeenCalledWith('/v1/debit-memos/dm-1');
    await verifyId('bill-run', 'br-1');
    expect(mockApiGet).toHaveBeenCalledWith('/v1/bill-runs/br-1');
  });
});

describe('resolveTargetId', () => {
  it('returns the mapped id when it verifies successfully', async () => {
    mockApiGet.mockResolvedValue({ success: true });
    const record = { _zdf: { intQA: { id: 'mapped-id', key: 'A-001' } } };
    const result = await resolveTargetId('account', record);
    expect(result).toEqual({ id: 'mapped-id', found: true });
    expect(mockApiQuery).not.toHaveBeenCalled();
  });

  it('falls back to a key search when the mapped id is stale (verify fails)', async () => {
    mockApiGet.mockRejectedValue(new Error('404'));
    mockApiQuery.mockResolvedValue([{ Id: 'found-via-search' }]);
    const record = {
      basicInfo: { accountNumber: 'A-001' },
      _zdf: { intQA: { id: 'stale-id', key: 'A-001' } },
    };
    const result = await resolveTargetId('account', record);
    expect(result).toEqual({ id: 'found-via-search', found: true });
    expect(mockApiGet).toHaveBeenCalledWith('/v1/accounts/stale-id');
    expect(mockApiQuery).toHaveBeenCalledWith(
      "SELECT Id FROM Account WHERE AccountNumber = 'A-001'"
    );
  });

  it('goes straight to key search when there is no map entry for the active env', async () => {
    mockApiQuery.mockResolvedValue([{ Id: 'found-via-search' }]);
    const record = { invoiceNumber: 'INV-1', _zdf: { staging: { id: 'other-env-id', key: 'INV-1' } } };
    const result = await resolveTargetId('invoice', record);
    expect(result).toEqual({ id: 'found-via-search', found: true });
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('returns found:false when neither a verified map id nor a key search succeeds', async () => {
    const record = {};
    const result = await resolveTargetId('invoice', record);
    expect(result).toEqual({ id: null, found: false });
  });

  it('returns found:false when the key search yields no match (0 rows)', async () => {
    mockApiQuery.mockResolvedValue([]);
    const record = { invoiceNumber: 'INV-404' };
    const result = await resolveTargetId('invoice', record);
    expect(result).toEqual({ id: null, found: false });
  });

  it('returns found:false when the key search is ambiguous (>1 rows)', async () => {
    mockApiQuery.mockResolvedValue([{ Id: 'a' }, { Id: 'b' }]);
    const record = { invoiceNumber: 'INV-dup' };
    const result = await resolveTargetId('invoice', record);
    expect(result).toEqual({ id: null, found: false });
  });

  it('uses activeEnvName() (getActiveEnv().name) to select the env map entry', async () => {
    mockGetActiveEnv.mockReturnValue({ name: 'staging', isProduction: false });
    mockApiGet.mockResolvedValue({ success: true });
    const record = { _zdf: { staging: { id: 'staging-id', key: 'A-1' }, intQA: { id: 'intqa-id', key: 'A-1' } } };
    const result = await resolveTargetId('account', record);
    expect(result).toEqual({ id: 'staging-id', found: true });
    expect(mockApiGet).toHaveBeenCalledWith('/v1/accounts/staging-id');
  });
});

describe('matchInvoiceItems', () => {
  it('matches a single item by skuName and amount, substituting the target item id', () => {
    const memoItems = [{ skuName: 'SKU-A', amount: 100 }];
    const targetItems = [
      { id: 'target-item-1', skuName: 'SKU-A', amount: 100 },
      { id: 'target-item-2', skuName: 'SKU-B', amount: 50 },
    ];
    const result = matchInvoiceItems(memoItems, targetItems);
    expect(result).toEqual([{ invoiceItemId: 'target-item-1', amount: 100, skuName: 'SKU-A' }]);
  });

  it('matches multiple items independently and preserves input order', () => {
    const memoItems = [
      { skuName: 'SKU-A', amount: 100 },
      { skuName: 'SKU-B', amount: 50 },
    ];
    const targetItems = [
      { id: 'target-item-2', skuName: 'SKU-B', amount: 50 },
      { id: 'target-item-1', skuName: 'SKU-A', amount: 100 },
    ];
    const result = matchInvoiceItems(memoItems, targetItems);
    expect(result).toEqual([
      { invoiceItemId: 'target-item-1', amount: 100, skuName: 'SKU-A' },
      { invoiceItemId: 'target-item-2', amount: 50, skuName: 'SKU-B' },
    ]);
  });

  it('falls back to the `sku` field name on both sides when `skuName` is absent', () => {
    const memoItems = [{ sku: 'SKU-A', amount: 100 }];
    const targetItems = [{ id: 'target-item-1', sku: 'SKU-A', amount: 100 }];
    const result = matchInvoiceItems(memoItems, targetItems);
    expect(result).toEqual([{ invoiceItemId: 'target-item-1', amount: 100, skuName: 'SKU-A' }]);
  });

  it('throws naming the skuName/amount when no target item matches', () => {
    const memoItems = [{ skuName: 'SKU-A', amount: 100 }];
    const targetItems = [{ id: 'target-item-1', skuName: 'SKU-A', amount: 999 }];
    expect(() => matchInvoiceItems(memoItems, targetItems)).toThrow(/SKU-A.*100/);
  });

  it('throws when zero target items exist at all', () => {
    const memoItems = [{ skuName: 'SKU-A', amount: 100 }];
    expect(() => matchInvoiceItems(memoItems, [])).toThrow(/No matching item/);
  });

  it('throws when more than one target item matches (ambiguous)', () => {
    const memoItems = [{ skuName: 'SKU-A', amount: 100 }];
    const targetItems = [
      { id: 'target-item-1', skuName: 'SKU-A', amount: 100 },
      { id: 'target-item-2', skuName: 'SKU-A', amount: 100 },
    ];
    expect(() => matchInvoiceItems(memoItems, targetItems)).toThrow(/Ambiguous match/);
  });

  it('throws when a memo item has no skuName/sku', () => {
    const memoItems = [{ amount: 100 }];
    expect(() => matchInvoiceItems(memoItems, [{ id: 'x', skuName: 'SKU-A', amount: 100 }])).toThrow(/skuName\/sku/);
  });

  it('throws when a memo item has no numeric amount', () => {
    const memoItems = [{ skuName: 'SKU-A' }];
    expect(() => matchInvoiceItems(memoItems, [{ id: 'x', skuName: 'SKU-A', amount: 100 }])).toThrow(/numeric amount/);
  });

  it('matches a string-valued amount against a numeric target amount', () => {
    const memoItems = [{ skuName: 'SKU-A', amount: '100' }];
    const targetItems = [{ id: 'target-item-1', skuName: 'SKU-A', amount: 100 }];
    const result = matchInvoiceItems(memoItems, targetItems);
    expect(result).toEqual([{ invoiceItemId: 'target-item-1', amount: 100, skuName: 'SKU-A' }]);
  });

  it('returns an empty array for an empty memoItems input', () => {
    expect(matchInvoiceItems([], [{ id: 'x', skuName: 'SKU-A', amount: 100 }])).toEqual([]);
  });
});
