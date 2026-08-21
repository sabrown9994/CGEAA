// Central per-resource metadata for (a) natural-key local file naming and (b) the cross-tenant
// env-id map / upsert feature. Kept in one place so file-io, the dependency graph, and the
// commands all agree on how a resource is identified.

type Rec = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * Extract a resource's NATURAL KEY (a tenant-stable, human-meaningful unique identifier) from a
 * fetched record — used both for the local filename and, for cross-tenant resources, as the
 * fallback search key. Returns undefined for resources that have no reliable natural key (those
 * fall back to the Zuora id for file naming). Field paths cover the different response shapes each
 * endpoint returns (e.g. account GET nests accountNumber under basicInfo; product object endpoint
 * is PascalCase `SKU` while Commerce is `sku`; order GET wraps under `order`).
 */
export const NATURAL_KEY: Record<string, (rec: Rec) => string | undefined> = {
  account: (r) => str((r['basicInfo'] as Rec | undefined)?.['accountNumber'] ?? r['accountNumber']),
  subscription: (r) => str(r['subscriptionNumber']),
  order: (r) => str((r['order'] as Rec | undefined)?.['orderNumber'] ?? r['orderNumber']),
  product: (r) => str(r['SKU'] ?? r['sku']),
  invoice: (r) => str(r['invoiceNumber']),
  'credit-memo': (r) => str(r['memoNumber'] ?? r['number']),
  'debit-memo': (r) => str(r['memoNumber'] ?? r['number']),
  'bill-run': (r) => str(r['billRunNumber'] ?? r['number'] ?? r['name']),
  // No entry (file naming falls back to the Zuora id, or the resource's command manages its own
  // filename):
  //   - contact, order-line-item, product-rate-plan, product-rate-plan-charge, data-query — no
  //     reliable unique natural key, so id.
  //   - workflow — keyed by id (definition names are not guaranteed unique).
  //   - billing-template — its command writes `<name>_<id>.json` itself (Settings API metadata).
};

/**
 * The filename (minus .json) for a resource's local file. Uses the natural key when the resource
 * has one and it's present on the record; otherwise falls back to `id`. `billing-template` keeps
 * its historical `<name>_<id>` shape (handled by its own command, not here).
 */
export function fileNameFor(resource: string, id: string, record?: Rec): string {
  const extractor = NATURAL_KEY[resource] as ((rec: Rec) => string | undefined) | undefined;
  const key = extractor && record ? extractor(record) : undefined;
  return sanitizeForFilename(key ?? id);
}

/** Filenames must satisfy file-io's path-segment rules; Zuora keys can contain e.g. spaces. */
export function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9\-_.]/g, '_');
}
