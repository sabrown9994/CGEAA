import { describe, it, expect } from 'vitest';
import { toAccountCreateBody, toInvoiceCreateBody } from '../../helpers/create-shape.js';

describe('toAccountCreateBody', () => {
  const pulledAccount = {
    id: 'stray-account-id',
    accountId: 'stray-account-id',
    status: 'Active',
    metrics: { balance: 100 },
    basicInfo: {
      id: 'stray-account-id',
      accountId: 'stray-account-id',
      accountNumber: 'A-SOURCE',
      name: 'Brand New Acct',
      currency: 'USD',
      billCycleDay: 99, // overridden by billingAndPayment.billCycleDay below when present
    },
    billingAndPayment: {
      currency: 'USD',
      billCycleDay: 5,
      autoPay: true,
    },
    billToContact: {
      id: 'contact-bill',
      accountId: 'stray-account-id',
      contactId: 'contact-bill',
      contactDescription: 'bill-to',
      firstName: 'Jane',
      lastName: 'Doe',
      workEmail: 'jane@example.com',
      address1: '123 Main St',
      address2: '',
      city: 'Springfield',
      state: 'CA',
      country: 'US',
      postalCode: '90210',
      county: null,
      taxRegion: 'CA-REGION',
    },
    soldToContact: {
      id: 'contact-sold',
      accountId: 'stray-account-id',
      contactDescription: 'sold-to',
      firstName: 'John',
      lastName: 'Smith',
      country: 'US',
    },
    Class__NS: 'ClassA',
    ignoredField: 'should not appear',
    _zdf: { sandbox: { id: 'stray-account-id', key: 'A-SOURCE' } },
  };

  it('maps the pulled shape to exactly the known-good account create body', () => {
    const result = toAccountCreateBody(pulledAccount);

    expect(result).toEqual({
      accountNumber: 'A-SOURCE',
      name: 'Brand New Acct',
      currency: 'USD',
      billCycleDay: 5,
      autoPay: true,
      billToContact: {
        firstName: 'Jane',
        lastName: 'Doe',
        workEmail: 'jane@example.com',
        address1: '123 Main St',
        city: 'Springfield',
        state: 'CA',
        country: 'US',
        postalCode: '90210',
        taxRegion: 'CA-REGION',
      },
      soldToContact: {
        firstName: 'John',
        lastName: 'Smith',
        country: 'US',
      },
      invoiceCollect: false,
      Class__NS: 'ClassA',
    });
  });

  it('never carries _zdf, id, status, accountId, contactDescription, or metrics', () => {
    const result = toAccountCreateBody(pulledAccount);

    expect(result).not.toHaveProperty('_zdf');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('accountId');
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('metrics');
    expect(result).not.toHaveProperty('contactDescription');
    const billTo = result['billToContact'] as Record<string, unknown>;
    expect(billTo).not.toHaveProperty('id');
    expect(billTo).not.toHaveProperty('accountId');
    expect(billTo).not.toHaveProperty('contactId');
    expect(billTo).not.toHaveProperty('contactDescription');
    // Falsy-but-present fields (empty string, null) are dropped, not carried through as blanks.
    expect(billTo).not.toHaveProperty('address2');
    expect(billTo).not.toHaveProperty('county');
  });

  it('preserves state on both contacts (US/CA tax requirement) when present', () => {
    const result = toAccountCreateBody(pulledAccount);
    expect((result['billToContact'] as Record<string, unknown>)['state']).toBe('CA');
  });

  it('falls back to basicInfo.currency and basicInfo.billCycleDay / autoPay defaults when billingAndPayment is absent', () => {
    const result = toAccountCreateBody({
      basicInfo: { accountNumber: 'A-2', name: 'No Billing Block', currency: 'EUR', billCycleDay: 12 },
    });
    expect(result).toMatchObject({
      accountNumber: 'A-2',
      name: 'No Billing Block',
      currency: 'EUR',
      billCycleDay: 12,
      autoPay: false,
      invoiceCollect: false,
    });
  });

  it('defaults billCycleDay to 1 when neither billingAndPayment nor basicInfo provide it', () => {
    const result = toAccountCreateBody({ basicInfo: { name: 'Minimal' } });
    expect(result['billCycleDay']).toBe(1);
    expect(result['autoPay']).toBe(false);
    expect(result['invoiceCollect']).toBe(false);
  });

  it('omits billToContact/soldToContact entirely when the pulled record has none', () => {
    const result = toAccountCreateBody({ basicInfo: { name: 'No Contacts' } });
    expect(result).not.toHaveProperty('billToContact');
    expect(result).not.toHaveProperty('soldToContact');
  });

  it('handles a completely empty pulled record without throwing', () => {
    const result = toAccountCreateBody({});
    expect(result).toEqual({ billCycleDay: 1, autoPay: false, invoiceCollect: false });
  });
});

describe('toInvoiceCreateBody', () => {
  const pulledInvoice = {
    id: 'stray-invoice-id',
    invoiceNumber: 'INV-001',
    status: 'Draft',
    accountNumber: 'A-SOURCE',
    invoiceDate: '2026-08-21',
    _zdf: { sandbox: { id: 'stray-invoice-id', key: 'INV-001' } },
    invoiceItems: [
      {
        id: 'item-1',
        invoiceId: 'stray-invoice-id',
        amount: 42,
        serviceStartDate: '2026-08-21 00:00:00',
        serviceEndDate: '2026-09-20 00:00:00',
        chargeName: 'Base Fee',
        revenueRecognitionRuleName: 'Recognize upon invoicing',
        deferredRevenueAccountingCode: 'Deferred Rev',
        recognizedRevenueAccountingCode: 'Recognized Rev',
        unbilledReceivablesAccountingCode: 'Unbilled AR',
        contractAssetAccountingCode: 'Contract Asset',
        contractLiabilityAccountingCode: 'Contract Liability',
        contractRecognizedRevenueAccountingCode: 'Contract Recognized Rev',
        adjustmentLiabilityAccountingCode: 'Adj Liability',
        adjustmentRevenueAccountingCode: 'Adj Revenue',
        taxAmount: 0,
        balance: 42,
      },
      {
        id: 'item-2',
        amount: 10,
        // sparse item — only amount + chargeName present
        chargeName: 'Support Fee',
      },
    ],
  };

  it('maps the pulled invoice + embedded items to exactly the flat create body', () => {
    const result = toInvoiceCreateBody(pulledInvoice);

    expect(result).toEqual({
      accountNumber: 'A-SOURCE',
      invoiceDate: '2026-08-21',
      invoiceItems: [
        {
          amount: 42,
          serviceStartDate: '2026-08-21 00:00:00',
          serviceEndDate: '2026-09-20 00:00:00',
          chargeName: 'Base Fee',
          revenueRecognitionRuleName: 'Recognize upon invoicing',
          deferredRevenueAccountingCode: 'Deferred Rev',
          recognizedRevenueAccountingCode: 'Recognized Rev',
          unbilledReceivablesAccountingCode: 'Unbilled AR',
          contractAssetAccountingCode: 'Contract Asset',
          contractLiabilityAccountingCode: 'Contract Liability',
          contractRecognizedRevenueAccountingCode: 'Contract Recognized Rev',
          adjustmentLiabilityAccountingCode: 'Adj Liability',
          adjustmentRevenueAccountingCode: 'Adj Revenue',
        },
        {
          amount: 10,
          chargeName: 'Support Fee',
        },
      ],
    });
  });

  it('never carries _zdf, invoice id/status, or item ids/read-only fields', () => {
    const result = toInvoiceCreateBody(pulledInvoice);

    expect(result).not.toHaveProperty('_zdf');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('invoiceNumber');
    for (const item of result['invoiceItems'] as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty('id');
      expect(item).not.toHaveProperty('invoiceId');
      expect(item).not.toHaveProperty('taxAmount');
      expect(item).not.toHaveProperty('balance');
    }
  });

  it('does not invent accounting/date fields the pulled item lacks', () => {
    const result = toInvoiceCreateBody(pulledInvoice);
    const sparseItem = (result['invoiceItems'] as Record<string, unknown>[])[1];
    expect(sparseItem).toEqual({ amount: 10, chargeName: 'Support Fee' });
    expect(sparseItem).not.toHaveProperty('deferredRevenueAccountingCode');
    expect(sparseItem).not.toHaveProperty('serviceStartDate');
  });

  it('omits accountNumber/invoiceDate when absent, and returns an empty invoiceItems array when there are none', () => {
    const result = toInvoiceCreateBody({});
    expect(result).toEqual({ invoiceItems: [] });
  });

  it('tolerates non-object items in the invoiceItems array without throwing', () => {
    const result = toInvoiceCreateBody({ accountNumber: 'A-1', invoiceItems: [null, 'not-an-object', 5] });
    expect(result['invoiceItems']).toEqual([{}, {}, {}]);
  });
});
