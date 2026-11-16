import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApiQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiQuery: mockApiQuery }));

import { resolveCatalogId } from '../../helpers/catalog-resolve.js';

const INTERNAL_ID = '2c92c0f965ff2d4201660fb2b2ca7b23';

beforeEach(() => {
  mockApiQuery.mockReset();
});

describe('resolveCatalogId', () => {
  it('returns a 32-char hex id as-is without calling apiQuery (id passthrough)', async () => {
    const result = await resolveCatalogId('product', INTERNAL_ID);
    expect(result).toBe(INTERNAL_ID);
    expect(mockApiQuery).not.toHaveBeenCalled();
  });

  it('treats an uppercase-hex 32-char string as an id too (case-insensitive)', async () => {
    const upper = INTERNAL_ID.toUpperCase();
    const result = await resolveCatalogId('product', upper);
    expect(result).toBe(upper);
    expect(mockApiQuery).not.toHaveBeenCalled();
  });

  it('product: resolves a SKU hit via ZOQL (SKU OR Name)', async () => {
    mockApiQuery.mockResolvedValue([{ Id: INTERNAL_ID }]);
    const result = await resolveCatalogId('product', 'PTL-EDG');
    expect(result).toBe(INTERNAL_ID);
    expect(mockApiQuery).toHaveBeenCalledWith(`SELECT Id FROM Product WHERE SKU = 'PTL-EDG' OR Name = 'PTL-EDG'`);
  });

  it('product: resolves a Name hit via ZOQL', async () => {
    mockApiQuery.mockResolvedValue([{ Id: INTERNAL_ID }]);
    const result = await resolveCatalogId('product', 'PriceVantage');
    expect(result).toBe(INTERNAL_ID);
    expect(mockApiQuery).toHaveBeenCalledWith(`SELECT Id FROM Product WHERE SKU = 'PriceVantage' OR Name = 'PriceVantage'`);
  });

  it('product-rate-plan: resolves by Name only', async () => {
    mockApiQuery.mockResolvedValue([{ Id: INTERNAL_ID }]);
    const result = await resolveCatalogId('product-rate-plan', 'Monthly Plan');
    expect(result).toBe(INTERNAL_ID);
    expect(mockApiQuery).toHaveBeenCalledWith(`SELECT Id FROM ProductRatePlan WHERE Name = 'Monthly Plan'`);
  });

  it('product-rate-plan-charge: resolves by Name only', async () => {
    mockApiQuery.mockResolvedValue([{ Id: INTERNAL_ID }]);
    const result = await resolveCatalogId('product-rate-plan-charge', 'Monthly Fee');
    expect(result).toBe(INTERNAL_ID);
    expect(mockApiQuery).toHaveBeenCalledWith(`SELECT Id FROM ProductRatePlanCharge WHERE Name = 'Monthly Fee'`);
  });

  it('throws a clear not-found error naming the resource and key on 0 rows', async () => {
    mockApiQuery.mockResolvedValue([]);
    await expect(resolveCatalogId('product', 'NoSuchSku')).rejects.toThrow(
      'No product found matching "NoSuchSku".'
    );
  });

  it('throws an ambiguous error listing the candidate ids on >1 rows', async () => {
    mockApiQuery.mockResolvedValue([{ Id: 'id-one' }, { Id: 'id-two' }]);
    await expect(resolveCatalogId('product', 'Dup')).rejects.toThrow(
      'Ambiguous product key "Dup" matched 2 records: id-one, id-two. Use the internal id instead.'
    );
  });

  it('escapes single quotes in the key the same way upsert.ts searchByKey does', async () => {
    mockApiQuery.mockResolvedValue([{ Id: INTERNAL_ID }]);
    await resolveCatalogId('product', "O'Brien's Plan");
    expect(mockApiQuery).toHaveBeenCalledWith(
      `SELECT Id FROM Product WHERE SKU = 'O''Brien''s Plan' OR Name = 'O''Brien''s Plan'`
    );
  });
});
