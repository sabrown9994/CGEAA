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
// IMPORTANT: only resources whose Zuora endpoints accept the natural key as the key/id are listed
// here. Files are named by the natural key, and push/delete pass the CLI arg straight into the
// endpoint path — so the natural key MUST be a valid Zuora key for the resource's read AND write
// endpoints. Verified live (2026-08-21): account/subscription/invoice accept their number; the
// order endpoint already uses the order number; credit-/debit-memo keys are ID-or-number per
// Zuora. Deliberately EXCLUDED: product (its `/v1/object/product/{id}` endpoint rejects the SKU —
// 400 — so SKU-named files would break push/delete) and bill-run (its GET uses the internal id).
export const NATURAL_KEY: Record<string, (rec: Rec) => string | undefined> = {
  account: (r) => str((r['basicInfo'] as Rec | undefined)?.['accountNumber'] ?? r['accountNumber']),
  subscription: (r) => str(r['subscriptionNumber']),
  order: (r) => str((r['order'] as Rec | undefined)?.['orderNumber'] ?? r['orderNumber']),
  invoice: (r) => str(r['invoiceNumber']),
  'credit-memo': (r) => str(r['memoNumber'] ?? r['number']),
  'debit-memo': (r) => str(r['memoNumber'] ?? r['number']),
  // No entry → file naming falls back to the Zuora id (or the resource's command manages its own
  // filename): contact, order-line-item, product, product-rate-plan, product-rate-plan-charge,
  // bill-run, data-query (id); workflow (id — names not guaranteed unique); billing-template
  // (`<name>_<id>.json`, written by its own command).
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

/** True if this resource is stored under a natural-key filename (so a lookup by internal id must
 * fall back to scanning for the file whose stored record id matches). */
export function hasNaturalKey(resource: string): boolean {
  return resource in NATURAL_KEY;
}

/** Extract the internal Zuora id from a stored record (covers the shapes ZDF writes: top-level
 * id/Id, and account's nested basicInfo.id). Used to match a natural-key-named file to an id arg. */
export function recordId(record: Rec): string | undefined {
  return str(record['id'] ?? record['Id'] ?? (record['basicInfo'] as Rec | undefined)?.['id']);
}
