import { describe, it, expect } from 'vitest';
import { fileNameFor, sanitizeForFilename, CROSS_TENANT } from '../../helpers/resource-registry.js';

describe('fileNameFor — natural-key file naming', () => {
  it('uses accountNumber for accounts (nested under basicInfo or top-level)', () => {
    expect(fileNameFor('account', 'internal-id-1', { basicInfo: { accountNumber: 'ACG00026617' } })).toBe('ACG00026617');
    expect(fileNameFor('account', 'internal-id-1', { accountNumber: 'ACG00099' })).toBe('ACG00099');
  });

  it('uses the natural key for invoice/memos/subscription/order (endpoints accept the number)', () => {
    expect(fileNameFor('invoice', 'id', { invoiceNumber: 'INV-100' })).toBe('INV-100');
    expect(fileNameFor('credit-memo', 'id', { memoNumber: 'CM-1' })).toBe('CM-1');
    expect(fileNameFor('debit-memo', 'id', { memoNumber: 'DM-1' })).toBe('DM-1');
    expect(fileNameFor('subscription', 'id', { subscriptionNumber: 'A-S1' })).toBe('A-S1');
    expect(fileNameFor('order', 'id', { orderNumber: 'O-1' })).toBe('O-1');
  });

  it('uses SKU for product — the object endpoint rejects the SKU directly, but push resolves the real write id via resolveTargetId and delete resolves it from the local file, so SKU-naming is safe', () => {
    expect(fileNameFor('product', 'internal-id-1', { SKU: 'SKU-9' })).toBe('SKU-9');
    // Commerce API responses use lowercase `sku`.
    expect(fileNameFor('product', 'internal-id-1', { sku: 'sku-lower' })).toBe('sku-lower');
  });

  it('falls back to the id where the natural key is NOT a valid Zuora endpoint key or is absent', () => {
    // bill-run: GET uses the internal id -> id-named.
    expect(fileNameFor('bill-run', 'BR-id', { billRunNumber: 'BR-1' })).toBe('BR-id');
    // no natural key at all:
    expect(fileNameFor('contact', 'CON-abc', { workEmail: 'x@y.com' })).toBe('CON-abc');
    expect(fileNameFor('order-line-item', 'OLI-1', { itemName: 'x' })).toBe('OLI-1');
    expect(fileNameFor('product-rate-plan', 'PRP-1', { Name: 'Plan' })).toBe('PRP-1');
    expect(fileNameFor('workflow', '2327', { name: 'My WF' })).toBe('2327');
  });

  it('falls back to the id when the natural-key field is missing/blank on the record', () => {
    expect(fileNameFor('account', 'fallback-id', {})).toBe('fallback-id');
    expect(fileNameFor('invoice', 'fallback-id', { invoiceNumber: '   ' })).toBe('fallback-id');
    // product with no SKU on the record -> falls back to id, same as the other resources.
    expect(fileNameFor('product', 'fallback-id', {})).toBe('fallback-id');
    expect(fileNameFor('product', 'fallback-id', { SKU: '   ' })).toBe('fallback-id');
  });

  it('sanitizes characters not allowed in a path segment', () => {
    expect(sanitizeForFilename('A/B C:D')).toBe('A_B_C_D');
    expect(fileNameFor('invoice', 'id', { invoiceNumber: 'INV 1/2' })).toBe('INV_1_2');
  });
});

describe('CROSS_TENANT — cross-tenant env-id map config', () => {
  it('has exactly the 6 expected resources with the correct ZOQL object/key field', () => {
    expect(Object.keys(CROSS_TENANT).sort()).toEqual(
      ['account', 'bill-run', 'credit-memo', 'debit-memo', 'invoice', 'product'].sort()
    );
    expect(CROSS_TENANT.account).toEqual({ zoqlObject: 'Account', zoqlKeyField: 'AccountNumber', upsertable: true });
    expect(CROSS_TENANT.product).toEqual({ zoqlObject: 'Product', zoqlKeyField: 'SKU', upsertable: true });
    expect(CROSS_TENANT.invoice).toEqual({ zoqlObject: 'Invoice', zoqlKeyField: 'InvoiceNumber', upsertable: true });
    expect(CROSS_TENANT['credit-memo']).toEqual({ zoqlObject: 'CreditMemo', zoqlKeyField: 'MemoNumber', upsertable: true });
    expect(CROSS_TENANT['debit-memo']).toEqual({ zoqlObject: 'DebitMemo', zoqlKeyField: 'MemoNumber', upsertable: true });
  });

  it('marks bill-run as NOT upsertable (no PUT endpoint for bill runs)', () => {
    expect(CROSS_TENANT['bill-run']).toEqual({ zoqlObject: 'BillRun', zoqlKeyField: 'BillRunNumber', upsertable: false });
  });
});
