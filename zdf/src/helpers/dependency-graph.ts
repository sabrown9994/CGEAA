import { apiGet, apiQuery } from '../api/client.js';
import { writeResourceFile, deleteResourceFile } from './file-io.js';
import { output } from './output.js';
import { assertReadSuccess } from './zuora-response.js';
import { startProgress, updateProgress, stopProgress } from './progress.js';

let noDependency = false;
export function setNoDependency(flag: boolean): void { noDependency = flag; }
export function isNoDependency(): boolean { return noDependency; }

// Dependency traversal (account -> invoices -> bill-run -> invoices -> ...) can explode
// on a busy tenant even with the visited-set cycle guard, since the graph legitimately
// contains thousands of distinct nodes. This ceiling bounds total nodes visited per
// resolveAndSync call tree so a runaway pull degrades gracefully (warns + stops
// traversing further) instead of issuing thousands of serial GETs. High enough that
// normal small/medium accounts never hit it. `--no-dependency` bypasses traversal
// entirely and is unaffected by this ceiling.
export const MAX_TRAVERSAL_NODES = 500;

// Current effective ceiling. Defaults to the constant above; overridable per-invocation
// via `--max-nodes <n>` (or set to Infinity by `--no-caps`/`--unbounded`).
let maxTraversalNodes: number = MAX_TRAVERSAL_NODES;

export function setMaxTraversalNodes(n: number): void {
  maxTraversalNodes = n;
}

// Tracks which `visited` sets have already emitted the ceiling warning, so a single
// resolveAndSync call tree (which threads one Set through all recursive calls) warns
// only once even though the ceiling is checked at every node.
const warnedVisitedSets = new WeakSet<Set<string>>();

// Some sub-item list endpoints ignore their filter query param entirely (observed:
// `/v1/orders?accountId=X` returns the WHOLE tenant's orders, not just X's), so
// fetchAllItems can paginate through tens of thousands of rows before the per-node
// MAX_TRAVERSAL_NODES ceiling above ever gets a chance to engage — that ceiling only
// checks in between resolveAndSync calls, not mid-pagination. This is an independent,
// lower-level bound on a single fetchAllItems call so a mis-scoped endpoint can't
// still explode a pull. Sized consistently with APIQUERY_MAX_ROWS in api/client.ts.
// High enough that normal accounts' sub-item lists finish well under it.
export const FETCH_ALL_ITEMS_MAX = 5000;

// Current effective ceiling. Defaults to the constant above; overridable per-invocation
// via `--max-items <n>` (or set to Infinity by `--no-caps`/`--unbounded`).
let fetchAllItemsMax: number = FETCH_ALL_ITEMS_MAX;

export function setMaxItems(n: number): void {
  fetchAllItemsMax = n;
}

/** Current effective per-call items cap (see setMaxItems above). Reused by callers
 * outside the dependency graph (e.g. `list orders`' per-line-item fetch loop) that
 * need to respect the same --max-items / --no-caps configuration. */
export function getMaxItems(): number {
  return fetchAllItemsMax;
}

type Action = 'pull' | 'push' | 'delete';

interface ResourceRecord extends Record<string, unknown> {
  success?: boolean;
}

const ENDPOINTS: Record<string, (id: string) => string> = {
  account: (id) => `/v1/accounts/${id}`,
  contact: (id) => `/v1/contacts/${id}`,
  subscription: (id) => `/v1/subscriptions/${id}`,
  order: (id) => `/v1/orders/${id}`,
  'order-line-item': (id) => `/v1/order-line-items/${id}`,
  product: (id) => `/v1/object/product/${id}`,
  'product-rate-plan': (id) => `/v1/object/product-rate-plan/${id}`,
  'product-rate-plan-charge': (id) => `/v1/object/product-rate-plan-charge/${id}`,
  invoice: (id) => `/v1/invoices/${id}`,
  'credit-memo': (id) => `/v1/credit-memos/${id}`,
  'debit-memo': (id) => `/v1/debit-memos/${id}`,
  'bill-run': (id) => `/v1/bill-runs/${id}`,
};

/** Fetch all pages of sub-items from a paginated sub-endpoint. */
async function fetchAllItems<T>(firstUrl: string, itemsKey: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | undefined = firstUrl;
  let page = 1;
  try {
    while (url) {
      if (page === 1) startProgress(`Fetching ${itemsKey} page ${page}…`);
      else updateProgress(`Fetching ${itemsKey} page ${page} (${all.length} so far)…`);
      const res = await apiGet<Record<string, unknown>>(url);
      const items = res[itemsKey] as T[] | undefined;
      if (items) all.push(...items);
      // Read the next-page cursor BEFORE the cap check: only warn about truncation if we
      // are stopping while more pages actually remain. A final page that lands exactly on
      // the cap with no nextPage has fetched everything, so it must not warn.
      url = res['nextPage'] as string | undefined;
      if (all.length >= fetchAllItemsMax) {
        if (url) {
          stopProgress();
          output.warn(
            `fetchAllItems: stopped ${itemsKey} at the ${fetchAllItemsMax}-item cap while more pages ` +
            `remained (endpoint may have ignored a filter param and returned more than expected); ` +
            `some sub-items were not fetched. Re-run with --no-dependency or --max-items for large accounts.`
          );
        }
        break;
      }
      page++;
    }
  } finally {
    stopProgress();
  }
  return all;
}

async function fetchAndWrite(resource: string, id: string): Promise<ResourceRecord | null> {
  const endpoint = ENDPOINTS[resource];
  if (!endpoint) return null;
  try {
    const data = await apiGet<ResourceRecord>(endpoint(id));
    assertReadSuccess(data, `${resource} fetch`);
    const { success: _s, ...record } = data;

    // For invoices, credit-memos, and debit-memos, embed sub-item arrays.
    if (resource === 'invoice') {
      record['invoiceItems'] = await fetchAllItems(
        `/v1/invoices/${id}/items`,
        'invoiceItems'
      );
    } else if (resource === 'credit-memo') {
      record['creditMemoItems'] = await fetchAllItems(
        `/v1/credit-memos/${id}/items`,
        'items'
      );
    } else if (resource === 'debit-memo') {
      record['debitMemoItems'] = await fetchAllItems(
        `/v1/debit-memos/${id}/items`,
        'items'
      );
    }

    writeResourceFile(resource, id, record);
    return record;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) {
      deleteResourceFile(resource, id);
      return null;
    }
    output.warn(`Failed to re-fetch ${resource} ${id}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Fetches `resource`/`id` and, unless `--no-dependency`, traverses its related records.
 *
 * Returns whether THIS call's own `fetchAndWrite` succeeded (i.e. a record was written for
 * `resource`/`id`). Callers that invoke this at the top level (command actions, always with
 * the default empty `visited` set) use the return value to decide whether to report success.
 * Recursive calls made from the `rules*` functions below pass the shared `visited` set for a
 * CHILD resource; those calls intentionally ignore the return value so a child fetch failure
 * still warns (via `fetchAndWrite`) and traversal continues — only the top-level request's own
 * result determines pull success/failure.
 */
export async function resolveAndSync(
  resource: string,
  id: string,
  action: Action,
  visited: Set<string> = new Set()
): Promise<boolean> {
  const key = `${resource}:${id}`;
  if (visited.has(key)) return false;

  if (!noDependency && visited.size >= maxTraversalNodes) {
    if (!warnedVisitedSets.has(visited)) {
      warnedVisitedSets.add(visited);
      output.warn(
        `Dependency traversal hit the ${maxTraversalNodes}-node ceiling; stopping further traversal. ` +
        `Some related records may not have been synced. Re-run with --no-dependency to skip traversal on a large account.`
      );
    }
    return false;
  }

  visited.add(key);

  const record = await fetchAndWrite(resource, id);
  if (!record) return false;

  if (!noDependency) {
    await applyRules(resource, id, action, record, visited);
  }
  return true;
}

async function applyRules(
  resource: string,
  id: string,
  action: Action,
  record: ResourceRecord,
  visited: Set<string>
): Promise<void> {
  switch (resource) {
    case 'account': await rulesAccount(id, action, record, visited); break;
    case 'contact': await rulesContact(action, record, visited); break;
    case 'order': await rulesOrder(id, action, record, visited); break;
    case 'order-line-item': await rulesOrderLineItem(action, record, visited); break;
    case 'subscription': await rulesSubscription(action, record, visited); break;
    case 'product': await rulesProduct(id, action, record, visited); break;
    case 'product-rate-plan': await rulesProductRatePlan(id, action, record, visited); break;
    case 'product-rate-plan-charge': await rulesProductRatePlanCharge(action, record, visited); break;
    case 'invoice': await rulesInvoice(id, action, record, visited); break;
    case 'credit-memo': await rulesCreditMemo(id, action, record, visited); break;
    case 'debit-memo': await rulesDebitMemo(id, action, record, visited); break;
    case 'bill-run': await rulesBillRun(id, action, record, visited); break;
  }
}

async function rulesAccount(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (record['parentId']) {
    await resolveAndSync('account', record['parentId'] as string, 'pull', visited);
  }
  if (action === 'pull') {
    const contactIds = await apiQuery<{ Id: string }>(`SELECT Id FROM Contact WHERE AccountId = '${id}'`);
    for (const c of contactIds) await resolveAndSync('contact', c.Id, 'pull', visited);

    // The generic /v1/orders?accountId= filter is ignored server-side (observed on intQA:
    // byte-identical to the unfiltered tenant-wide list), so scope via the dedicated
    // subscriptionOwner endpoint instead. That endpoint takes the account NUMBER/key
    // (e.g. ACG00018042), not the internal id passed into rulesAccount — resolve it off
    // the already-fetched account record (basicInfo.accountNumber or accountNumber).
    const accountNumber = ((record['basicInfo'] as ResourceRecord | undefined)?.['accountNumber']
      ?? record['accountNumber']) as string | undefined;
    if (accountNumber) {
      const orders = await fetchAllItems<{ orderNumber: string }>(
        `/v1/orders/subscriptionOwner/${encodeURIComponent(accountNumber)}`,
        'orders'
      );
      for (const o of orders) await resolveAndSync('order', o.orderNumber, 'pull', visited);
    }
    // else: account record carries no number (unexpected for a real Zuora account GET
    // response) — skip order traversal for this node rather than fetch tenant-wide.

    const subs = await fetchAllItems<{ id: string }>(`/v1/subscriptions/accounts/${id}`, 'subscriptions');
    for (const s of subs) await resolveAndSync('subscription', s.id, 'pull', visited);

    const invs = await fetchAllItems<{ id: string }>(`/v1/transactions/invoices/accounts/${id}`, 'invoices');
    for (const inv of invs) await resolveAndSync('invoice', inv.id, 'pull', visited);

    const cms = await fetchAllItems<{ id: string }>(`/v1/credit-memos?accountId=${id}`, 'creditmemos');
    for (const cm of cms) await resolveAndSync('credit-memo', cm.id, 'pull', visited);

    const dms = await fetchAllItems<{ id: string }>(`/v1/debit-memos?accountId=${id}`, 'debitmemos');
    for (const dm of dms) await resolveAndSync('debit-memo', dm.id, 'pull', visited);

    const billRunIds = await apiQuery<{ Id: string }>(`SELECT Id FROM BillRun WHERE AccountId = '${id}'`);
    for (const br of billRunIds) await resolveAndSync('bill-run', br.Id, 'pull', visited);
  }
}

async function rulesContact(action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) {
      await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
    }
  }
}

async function rulesOrder(_id: string, _action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  // GET /v1/orders/{orderNumber} wraps the order under an 'order' key; unwrap before
  // reading, same as the push path (src/commands/orders.ts: rawFull['order'] ?? rawFull).
  // Stay safe when there's no envelope (defensive/older shape).
  const o = (record['order'] as ResourceRecord | undefined) ?? record;

  // Order record uses existingAccountNumber; GET /v1/accounts/{accountNumber} returns the full account record
  const accountNumber = (o['existingAccountNumber'] ?? o['accountNumber']) as string | undefined;
  if (accountNumber) {
    const acctRecord = await apiGet<ResourceRecord>(`/v1/accounts/${accountNumber}`);
    const acctId = (acctRecord['basicInfo'] as ResourceRecord | undefined)?.['id'] as string | undefined;
    if (acctId) await resolveAndSync('account', acctId, 'pull', visited);
  }

  const items = (o['orderLineItems'] as Array<{ id: string }> | undefined) ?? [];
  for (const item of items) await resolveAndSync('order-line-item', item.id, 'pull', visited);

  const subs = (o['subscriptions'] as Array<{ subscriptionNumber: string }> | undefined) ?? [];
  for (const s of subs) await resolveAndSync('subscription', s.subscriptionNumber, 'pull', visited);
}

async function rulesOrderLineItem(action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['orderId']) {
      await resolveAndSync('order', record['orderId'] as string, action, visited);
    }
  }
}

async function rulesSubscription(action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
    if (record['orderNumber']) await resolveAndSync('order', record['orderNumber'] as string, 'pull', visited);
  }
}

async function rulesProduct(id: string, action: Action, _record: ResourceRecord, visited: Set<string>): Promise<void> {
  const plans = await apiQuery<{ Id: string }>(`SELECT Id FROM ProductRatePlan WHERE ProductId = '${id}'`);
  for (const plan of plans) {
    await resolveAndSync('product-rate-plan', plan.Id, action, visited);
  }
}

async function rulesProductRatePlan(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  // Object endpoint returns ProductId (PascalCase)
  const productId = (record['ProductId'] ?? record['productId']) as string | undefined;
  if (productId) await resolveAndSync('product', productId, 'pull', visited);

  if (action === 'pull') {
    const charges = await apiQuery<{ Id: string }>(`SELECT Id FROM ProductRatePlanCharge WHERE ProductRatePlanId = '${id}'`);
    for (const ch of charges) await resolveAndSync('product-rate-plan-charge', ch.Id, 'pull', visited);
  }
}

async function rulesProductRatePlanCharge(_action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  // Object endpoint returns ProductRatePlanId (PascalCase)
  const prpId = (record['ProductRatePlanId'] ?? record['productRatePlanId']) as string | undefined;
  if (prpId) {
    await resolveAndSync('product-rate-plan', prpId, 'pull', visited);
  }
}

async function rulesInvoice(_id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
  }
  if (record['billRunId']) await resolveAndSync('bill-run', record['billRunId'] as string, 'pull', visited);
}

async function rulesCreditMemo(_id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
  }
  if (record['sourceId']) {
    const brs = await apiQuery<{ Id: string }>(`SELECT Id FROM BillRun WHERE BillRunNumber = '${record['sourceId'] as string}'`);
    for (const br of brs) await resolveAndSync('bill-run', br.Id, 'pull', visited);
  }
}

async function rulesDebitMemo(_id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
  }
}

async function rulesBillRun(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);

  // Each child-lookup below is independently wrapped: intQA has been observed to reject
  // some of these ZOQL/GET calls with HTTP 400 (e.g. INVALID_TYPE on Invoice/DebitMemo
  // ZOQL), which would otherwise throw out of rulesBillRun and abort the entire pull for
  // any account that has bill-runs. Warn and continue instead — mirrors fetchAndWrite's
  // tolerant-of-non-404-errors pattern above.
  try {
    const invIds = await apiQuery<{ Id: string }>(`SELECT Id FROM Invoice WHERE BillRunId = '${id}'`);
    for (const inv of invIds) await resolveAndSync('invoice', inv.Id, action, visited);
  } catch (err: unknown) {
    output.warn(`Skipping invoices for bill-run ${id}: ${(err as Error).message}`);
  }

  try {
    const cmIds = await apiGet<{ creditMemos?: Array<{ id: string }> }>(`/v1/credit-memos?sourceId=${(record['billRunNumber'] as string) ?? id}`);
    for (const cm of cmIds.creditMemos ?? []) await resolveAndSync('credit-memo', cm.id, action, visited);
  } catch (err: unknown) {
    output.warn(`Skipping credit-memos for bill-run ${id}: ${(err as Error).message}`);
  }

  try {
    const dmIds = await apiQuery<{ Id: string }>(`SELECT Id FROM DebitMemo WHERE BillRunId = '${id}'`);
    for (const dm of dmIds) await resolveAndSync('debit-memo', dm.Id, action, visited);
  } catch (err: unknown) {
    output.warn(`Skipping debit-memos for bill-run ${id}: ${(err as Error).message}`);
  }
}
