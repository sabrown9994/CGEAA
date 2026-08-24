// Create-shape adapters: transform a PULLED (GET-shape) record into the flat body the Zuora
// CREATE endpoint actually accepts. A raw pulled account/invoice body is rejected outright by the
// create APIs (nested read-only fields, ids, status, etc. that the GET response carries but the
// POST body must not) — see zdf/CLAUDE.md "Invoice create / delete" and "Product create" for the
// known-good create-body shapes these mirror. Pure functions — no I/O, no Zuora calls. The caller
// (accounts.ts / invoices.ts push CREATE branch) still wraps the output in `stripEnvMap` as
// defense-in-depth, but these adapters never read or carry the `_zdf` map in the first place.

type Rec = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Copies `keys` from `source` onto a new object, keeping only those that are present and not
 * null/empty-string on `source`. Never invents values. */
function pick(source: Rec, keys: string[]): Rec {
  const out: Rec = {};
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out;
}

const CONTACT_CREATE_FIELDS = [
  'firstName',
  'lastName',
  'workEmail',
  'address1',
  'address2',
  'city',
  'state',
  'country',
  'postalCode',
  'county',
  'taxRegion',
];

/** Trims a pulled contact sub-object (billToContact/soldToContact) down to the fields the account
 * create API accepts, dropping id/accountId/contactId/contactDescription and any read-only/blank
 * fields. Returns undefined when the source isn't a usable object or has nothing to keep. */
function trimContact(source: unknown): Rec | undefined {
  if (!isRec(source)) return undefined;
  const trimmed = pick(source, CONTACT_CREATE_FIELDS);
  return Object.keys(trimmed).length > 0 ? trimmed : undefined;
}

/** Custom-field passthrough: account-level `*__c`/`*__NS` keys, only if present at top level of
 * the pulled record. Never invents values. */
function customFieldPassthrough(pulled: Rec): Rec {
  const out: Rec = {};
  for (const [key, value] of Object.entries(pulled)) {
    if ((key.endsWith('__c') || key.endsWith('__NS')) && value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Maps a pulled (GET-shape) account record to the flat account-create body that `POST
 * /v1/accounts` accepts. A raw pulled body is rejected live with "Invalid parameter(s):
 * accountId,accountNumber,contactDescription,id" — this adapter produces the known-good shape
 * instead. `accountNumber` is deliberately preserved (from `basicInfo.accountNumber`) so the
 * created target record stays matchable by natural key later (cross-tenant upsert).
 */
export function toAccountCreateBody(pulled: Rec): Rec {
  const basicInfo = isRec(pulled['basicInfo']) ? (pulled['basicInfo'] as Rec) : {};
  const billingAndPayment = isRec(pulled['billingAndPayment']) ? (pulled['billingAndPayment'] as Rec) : {};

  const body: Rec = {
    invoiceCollect: false,
  };

  const accountNumber = str(basicInfo['accountNumber']);
  if (accountNumber !== undefined) body['accountNumber'] = accountNumber;

  const name = str(basicInfo['name']);
  if (name !== undefined) body['name'] = name;

  const currency = str(basicInfo['currency'] ?? billingAndPayment['currency']);
  if (currency !== undefined) body['currency'] = currency;

  body['billCycleDay'] = billingAndPayment['billCycleDay'] ?? basicInfo['billCycleDay'] ?? 1;
  body['autoPay'] = billingAndPayment['autoPay'] ?? false;

  const billToContact = trimContact(pulled['billToContact']);
  if (billToContact) body['billToContact'] = billToContact;

  const soldToContact = trimContact(pulled['soldToContact']);
  if (soldToContact) body['soldToContact'] = soldToContact;

  Object.assign(body, customFieldPassthrough(pulled));

  return body;
}

const INVOICE_ITEM_ACCOUNTING_FIELDS = [
  'deferredRevenueAccountingCode',
  'recognizedRevenueAccountingCode',
  'unbilledReceivablesAccountingCode',
  'contractAssetAccountingCode',
  'contractLiabilityAccountingCode',
  'contractRecognizedRevenueAccountingCode',
  'adjustmentLiabilityAccountingCode',
  'adjustmentRevenueAccountingCode',
];

const INVOICE_ITEM_CREATE_FIELDS = [
  'amount',
  'serviceStartDate',
  'serviceEndDate',
  'chargeName',
  'revenueRecognitionRuleName',
  ...INVOICE_ITEM_ACCOUNTING_FIELDS,
];

/** Maps a single pulled invoice item to the create-body item shape: carries through whatever of
 * the allowed fields the pulled item actually has, dropping ids and any other read-only fields.
 * Never invents values. */
function toInvoiceItemCreateBody(item: unknown): Rec {
  if (!isRec(item)) return {};
  return pick(item, INVOICE_ITEM_CREATE_FIELDS);
}

/**
 * Maps a pulled (GET-shape) invoice record — including its embedded `invoiceItems` — to the flat
 * single-invoice create body `POST /v1/invoices` accepts (see zdf/CLAUDE.md "Invoice create").
 * `accountNumber` is read as-is off the pulled record; the command's account-FK remap (source
 * accountNumber → active-env account key) runs on the adapted body afterward, same as before.
 */
export function toInvoiceCreateBody(pulled: Rec): Rec {
  const body: Rec = {};

  const accountNumber = str(pulled['accountNumber']);
  if (accountNumber !== undefined) body['accountNumber'] = accountNumber;

  const invoiceDate = str(pulled['invoiceDate']);
  if (invoiceDate !== undefined) body['invoiceDate'] = invoiceDate;

  const items = Array.isArray(pulled['invoiceItems']) ? (pulled['invoiceItems'] as unknown[]) : [];
  body['invoiceItems'] = items.map(toInvoiceItemCreateBody);

  return body;
}

const MEMO_HEADER_CREATE_FIELDS = ['comment', 'reasonCode', 'effectiveDate'];

/**
 * Enriches the invoice-scoped memo create body (`POST /v1/{memo}s/invoice/{targetInvoiceKey}`,
 * see zdf/CLAUDE.md "Credit-memo / debit-memo creates") with the promoted memo's own header
 * fields, so a cross-tenant create carries more than just the matched line items. Only the
 * create-safe allowlisted header fields are carried — never ids, status, item arrays, or `_zdf`
 * (this function never reads those off `pulled` in the first place). A superset of today's
 * `{ items }`-only body: when none of the header fields are present, the result is identical.
 */
export function toMemoCreateBody(pulled: Rec, matchedItems: unknown[]): Rec {
  return {
    items: matchedItems,
    ...pick(pulled, MEMO_HEADER_CREATE_FIELDS),
  };
}
