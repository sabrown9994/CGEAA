// Resolves a `pull` CLI argument for the product catalog resources to the internal Zuora id.
// The legacy /v1/object/ GET endpoints that `pull` relies on for product / product-rate-plan /
// product-rate-plan-charge only accept the internal id (see zdf/CLAUDE.md "Legacy object
// endpoints for product catalog"). On a FIRST pull there is no local file yet to resolve a
// natural key (SKU/Name) from, so this resolves live via the synchronous ZOQL path (`apiQuery`,
// POST /v1/action/query) that dependency-graph traversal already trusts — NOT the async
// Data Query API (`create data-query`), which is a poor fit for a quick id lookup.
import { apiQuery } from '../api/client.js';
import { escapeZoqlString } from './upsert.js';

export type CatalogResource = 'product' | 'product-rate-plan' | 'product-rate-plan-charge';

// Zuora internal ids are 32-char hex strings. Anything else is treated as a natural key (SKU/Name).
const INTERNAL_ID_RE = /^[0-9a-f]{32}$/i;

const ZOQL_BY_RESOURCE: Record<CatalogResource, (escapedKey: string) => string> = {
  product: (k) => `SELECT Id FROM Product WHERE SKU = '${k}' OR Name = '${k}'`,
  'product-rate-plan': (k) => `SELECT Id FROM ProductRatePlan WHERE Name = '${k}'`,
  'product-rate-plan-charge': (k) => `SELECT Id FROM ProductRatePlanCharge WHERE Name = '${k}'`,
};

/**
 * Resolves `keyOrId` to an internal Zuora id for the given catalog resource.
 * - If `keyOrId` already looks like an internal id (32-char hex), it's returned as-is — no
 *   network call.
 * - Otherwise it's treated as a natural key (SKU and/or Name, depending on resource) and
 *   resolved live via ZOQL.
 * - Throws a clear "not found" error on 0 matching rows, or an "ambiguous" error (listing the
 *   candidate ids) on more than 1 — this never guesses.
 */
export async function resolveCatalogId(resource: CatalogResource, keyOrId: string): Promise<string> {
  if (INTERNAL_ID_RE.test(keyOrId)) return keyOrId;

  const escaped = escapeZoqlString(keyOrId);
  const zoql = ZOQL_BY_RESOURCE[resource](escaped);
  const rows = await apiQuery<{ Id: string }>(zoql);

  if (rows.length === 0) {
    throw new Error(`No ${resource} found matching "${keyOrId}".`);
  }
  if (rows.length > 1) {
    const ids = rows.map((r) => r.Id).join(', ');
    throw new Error(`Ambiguous ${resource} key "${keyOrId}" matched ${rows.length} records: ${ids}. Use the internal id instead.`);
  }
  return rows[0].Id;
}
