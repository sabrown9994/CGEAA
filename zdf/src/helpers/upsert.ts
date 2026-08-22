// Cross-tenant upsert resolver: given a resource and a record body, decides which target-tenant
// id (if any) the record should be written to. Pure resolution + search — no writes happen here.
// See zdf/CLAUDE.md for the cross-tenant env-id map background and resource-registry.ts for the
// CROSS_TENANT metadata this consumes.
import { apiGet, apiQuery } from '../api/client.js';
import { getEnvEntry, activeEnvName } from './env-map.js';
import { CROSS_TENANT } from './resource-registry.js';

type Rec = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * Extract a resource's cross-tenant search key value FROM THE RECORD BODY being upserted. This is
 * deliberately separate from resource-registry's `NATURAL_KEY` (which extracts from a FETCHED
 * record for local file naming, and excludes product/bill-run because their natural key isn't a
 * valid id for those resources' GET/PUT endpoints). Here we only need a ZOQL search value, so
 * product/bill-run are included.
 */
export function crossTenantKeyValue(resource: string, record: Rec): string | undefined {
  switch (resource) {
    case 'account':
      return str((record['basicInfo'] as Rec | undefined)?.['accountNumber'] ?? record['accountNumber']);
    case 'product':
      return str(record['SKU'] ?? record['sku']);
    case 'invoice':
      return str(record['invoiceNumber']);
    case 'credit-memo':
    case 'debit-memo':
      return str(record['memoNumber'] ?? record['number']);
    case 'bill-run':
      return str(record['billRunNumber'] ?? record['number'] ?? record['name']);
    default:
      return undefined;
  }
}

/** Per-resource GET endpoint used to verify a mapped id still exists in the active tenant. */
const GET_ENDPOINT: Record<string, (id: string) => string> = {
  account: (id) => `/v1/accounts/${id}`,
  product: (id) => `/v1/object/product/${id}`,
  invoice: (id) => `/v1/invoices/${id}`,
  'credit-memo': (id) => `/v1/credit-memos/${id}`,
  'debit-memo': (id) => `/v1/debit-memos/${id}`,
  'bill-run': (id) => `/v1/bill-runs/${id}`,
};

type GetResponse = {
  success?: boolean;
  reasons?: Array<{ code: unknown; message: unknown }>;
  errors?: Array<{ code: unknown; message: unknown }>;
};

/**
 * Search the active tenant for an existing record by its cross-tenant natural key. Returns the
 * matched id only when exactly one row matches (0 → nothing to link to; >1 → ambiguous, refuse to
 * guess). Single quotes in `key` are escaped by doubling, per ZOQL string-literal rules.
 */
export async function searchByKey(resource: string, key: string): Promise<string | undefined> {
  const config = CROSS_TENANT[resource];
  if (!config) return undefined;
  const escaped = key.replace(/'/g, "''");
  const rows = await apiQuery<{ Id: string }>(
    `SELECT Id FROM ${config.zoqlObject} WHERE ${config.zoqlKeyField} = '${escaped}'`
  );
  return rows.length === 1 ? rows[0].Id : undefined;
}

/**
 * Confirms a previously-recorded id still exists in the active tenant. Never throws — a 404/failed
 * GET means "not verified" (false), so the caller falls back to a key search rather than crashing.
 */
export async function verifyId(resource: string, id: string): Promise<boolean> {
  const buildPath = GET_ENDPOINT[resource];
  if (!buildPath) return false;
  try {
    const res = await apiGet<GetResponse>(buildPath(id));
    const reasons = res.reasons ?? res.errors ?? [];
    if (res.success === false || reasons.length > 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the target-tenant id a record should be upserted against, for the currently ACTIVE
 * environment: prefer a verified id from the record's `_zdf` env map; fall back to a cross-tenant
 * key search when the mapped id is missing or stale; otherwise signal that the caller must create
 * a new record (`found: false`).
 */
export async function resolveTargetId(
  resource: string,
  record: Rec
): Promise<{ id: string; found: true } | { id: null; found: false }> {
  const env = activeEnvName();
  const entry = getEnvEntry(record, env);

  if (entry?.id && (await verifyId(resource, entry.id))) {
    return { id: entry.id, found: true };
  }

  const key = crossTenantKeyValue(resource, record);
  if (key) {
    const foundId = await searchByKey(resource, key);
    if (foundId) {
      return { id: foundId, found: true };
    }
  }

  return { id: null, found: false };
}

export interface MatchedMemoItem {
  invoiceItemId: string;
  amount: unknown;
  skuName: string;
}

/** A source-tenant memo item's identifying fields for matching. Accepts either `skuName` (the
 * field name required by the credit-/debit-memo create body — see zdf/CLAUDE.md) or `sku`, since
 * it is not confirmed against live data which field name the item carries in every response shape. */
function itemSkuName(item: Rec): string | undefined {
  return str(item['skuName'] ?? item['sku']);
}

function itemAmount(item: Rec): number | undefined {
  const v = item['amount'];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/**
 * Matches each SOURCE-tenant memo item to exactly one item on the TARGET (active-tenant) invoice,
 * by (skuName, amount), and returns the create-body item shape with the target item's `id`
 * substituted in as `invoiceItemId`. Pure — no I/O. Throws (naming the offending skuName/amount) on:
 * a memo item missing skuName or a numeric amount, zero matches, or more than one match (ambiguous
 * — refuses to guess). Order of the returned array matches the input `memoItems` order.
 */
export function matchInvoiceItems(memoItems: Rec[], targetInvoiceItems: Rec[]): MatchedMemoItem[] {
  return memoItems.map((memoItem) => {
    const skuName = itemSkuName(memoItem);
    if (!skuName) {
      throw new Error('Memo item is missing a skuName/sku — cannot match it against the target invoice\'s items.');
    }
    const amount = itemAmount(memoItem);
    if (amount === undefined) {
      throw new Error(`Memo item "${skuName}" is missing a numeric amount — cannot match it against the target invoice's items.`);
    }
    const matches = targetInvoiceItems.filter((ti) => itemSkuName(ti) === skuName && itemAmount(ti) === amount);
    if (matches.length === 0) {
      throw new Error(`No matching item found on the target invoice for skuName "${skuName}" and amount ${amount}.`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous match: ${matches.length} items on the target invoice have skuName "${skuName}" and amount ${amount}.`);
    }
    const targetId = str(matches[0]['id']);
    if (!targetId) {
      throw new Error(`Matched target invoice item for skuName "${skuName}" has no id.`);
    }
    return { invoiceItemId: targetId, amount, skuName };
  });
}
