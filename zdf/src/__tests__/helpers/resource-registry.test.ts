import { describe, it, expect } from 'vitest';
import { fileNameFor, sanitizeForFilename } from '../../helpers/resource-registry.js';

describe('fileNameFor — natural-key file naming', () => {
  it('uses accountNumber for accounts (nested under basicInfo or top-level)', () => {
    expect(fileNameFor('account', 'internal-id-1', { basicInfo: { accountNumber: 'ACG00026617' } })).toBe('ACG00026617');
    expect(fileNameFor('account', 'internal-id-1', { accountNumber: 'ACG00099' })).toBe('ACG00099');
  });

  it('uses the natural key for invoice/memos/subscription/product/order/bill-run', () => {
    expect(fileNameFor('invoice', 'id', { invoiceNumber: 'INV-100' })).toBe('INV-100');
    expect(fileNameFor('credit-memo', 'id', { memoNumber: 'CM-1' })).toBe('CM-1');
    expect(fileNameFor('debit-memo', 'id', { memoNumber: 'DM-1' })).toBe('DM-1');
    expect(fileNameFor('subscription', 'id', { subscriptionNumber: 'A-S1' })).toBe('A-S1');
    expect(fileNameFor('product', 'id', { SKU: 'SKU-9' })).toBe('SKU-9');
    expect(fileNameFor('order', 'id', { orderNumber: 'O-1' })).toBe('O-1');
    expect(fileNameFor('bill-run', 'id', { billRunNumber: 'BR-1' })).toBe('BR-1');
  });

  it('falls back to the id when the resource has no natural key (contact, order-line-item, etc.)', () => {
    expect(fileNameFor('contact', 'CON-abc', { workEmail: 'x@y.com' })).toBe('CON-abc');
    expect(fileNameFor('order-line-item', 'OLI-1', { itemName: 'x' })).toBe('OLI-1');
    expect(fileNameFor('product-rate-plan', 'PRP-1', { Name: 'Plan' })).toBe('PRP-1');
    expect(fileNameFor('workflow', '2327', { name: 'My WF' })).toBe('2327');
  });

  it('falls back to the id when the natural-key field is missing/blank on the record', () => {
    expect(fileNameFor('account', 'fallback-id', {})).toBe('fallback-id');
    expect(fileNameFor('invoice', 'fallback-id', { invoiceNumber: '   ' })).toBe('fallback-id');
  });

  it('sanitizes characters not allowed in a path segment', () => {
    expect(sanitizeForFilename('A/B C:D')).toBe('A_B_C_D');
    expect(fileNameFor('product', 'id', { SKU: 'SKU 1/2' })).toBe('SKU_1_2');
  });
});
