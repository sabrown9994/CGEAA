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

// A parent descriptor threaded through traversal so a dependent that fails to pull can be
// attributed to the object it hangs off of.
interface Parent { resource: string; id: string; }

// Collects, per top-level pull, the dependent objects that could NOT be pulled — whether a
// whole category couldn't be listed (a discovery ZOQL/GET threw) or an individual child
// fetch failed. Reset at the start of every top-level resolveAndSync and flushed as a
// consolidated per-parent warning when that top-level traversal finishes.
interface DependencyFailure { parent: string; dependent: string; reason: string; }
let dependencyFailures: DependencyFailure[] = [];

/** The dependency failures collected during the most recent top-level pull. Exposed for tests. */
export function getDependencyFailures(): ReadonlyArray<DependencyFailure> {
  return dependencyFailures;
}

function recordDependencyFailure(parent: Parent, dependent: string, err: unknown): void {
  dependencyFailures.push({
    parent: `${parent.resource} ${parent.id}`,
    dependent,
    reason: err instanceof Error ? err.message : String(err),
  });
}

// The natural-key path the top-level pulled resource was written to (files are named by natural
// key now, not the id the user typed). Set by fetchAndWrite for the top-level object; read by pull
// commands for their success message. Reset at each top-level resolveAndSync.
let lastPulledPath: string | null = null;
export function getLastPulledPath(): string | null {
  return lastPulledPath;
}

function emitDependencyFailureSummary(): void {
  if (dependencyFailures.length === 0) return;
  const byParent = new Map<string, string[]>();
  for (const f of dependencyFailures) {
    if (!byParent.has(f.parent)) byParent.set(f.parent, []);
    byParent.get(f.parent)!.push(`${f.dependent} (${f.reason})`);
  }
  for (const [parent, deps] of byParent) {
    output.warn(`Some dependent objects of ${parent} were not pulled: ${deps.join('; ')}`);
  }
}

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

async function fetchAndWrite(resource: string, id: string, parent?: Parent): Promise<ResourceRecord | null> {
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

    const writtenPath = writeResourceFile(resource, id, record);
    if (parent === undefined) lastPulledPath = writtenPath;
    return record;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) {
      deleteResourceFile(resource, id);
      return null;
    }
    output.warn(`Failed to re-fetch ${resource} ${id}: ${(err as Error).message}`);
    // Attribute the failure to the parent this child hangs off of (if any) so the
    // top-level pull can surface a consolidated "dependent objects not pulled" warning.
    if (parent) recordDependencyFailure(parent, `${resource} ${id}`, err);
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
  visited: Set<string> = new Set(),
  parent?: Parent
): Promise<boolean> {
  // A call with no parent is the top-level request (command actions always call it this way).
  // Reset the per-pull failure collector on entry and flush the consolidated warning on exit.
  const isTopLevel = parent === undefined;
  if (isTopLevel) { dependencyFailures = []; lastPulledPath = null; }

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

  const record = await fetchAndWrite(resource, id, parent);
  if (!record) {
    if (isTopLevel) emitDependencyFailureSummary();
    return false;
  }

  if (!noDependency) {
    await applyRules(resource, id, action, record, visited);
  }
  if (isTopLevel) emitDependencyFailureSummary();
  return true;
}

async function applyRules(
  resource: string,
  id: string,
  action: Action,
  record: ResourceRecord,
  visited: Set<string>
): Promise<void> {
  // `self` is the parent for every child this object traverses to — a dependent that fails
  // to pull is attributed to it in the consolidated failure summary.
  const self: Parent = { resource, id };
  switch (resource) {
    case 'account': await rulesAccount(id, action, record, visited, self); break;
    case 'contact': await rulesContact(action, record, visited, self); break;
    case 'order': await rulesOrder(id, action, record, visited, self); break;
    case 'order-line-item': await rulesOrderLineItem(action, record, visited, self); break;
    case 'subscription': await rulesSubscription(action, record, visited, self); break;
    case 'product': await rulesProduct(id, action, record, visited, self); break;
    case 'product-rate-plan': await rulesProductRatePlan(id, action, record, visited, self); break;
    case 'product-rate-plan-charge': await rulesProductRatePlanCharge(action, record, visited, self); break;
    case 'invoice': await rulesInvoice(id, action, record, visited, self); break;
    case 'credit-memo': await rulesCreditMemo(id, action, record, visited, self); break;
    case 'debit-memo': await rulesDebitMemo(id, action, record, visited, self); break;
    case 'bill-run': await rulesBillRun(id, action, record, visited, self); break;
  }
}

/**
 * Run a discovery lookup (a ZOQL/GET that lists a category of dependent records) and traverse
 * each result. If the lookup itself throws, record the whole category as a dependency failure
 * against `self` and continue — a failed category never aborts the parent pull. Individual child
 * fetch failures are recorded separately inside fetchAndWrite (attributed to the same `self`).
 */
async function traverseCategory<T>(
  self: Parent,
  category: string,
  discover: () => Promise<T[]>,
  each: (item: T) => Promise<void>
): Promise<void> {
  let items: T[];
  try {
    items = await discover();
  } catch (err) {
    recordDependencyFailure(self, category, err);
    return;
  }
  for (const item of items) await each(item);
}

async function rulesAccount(id: string, action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (record['parentId']) {
    await resolveAndSync('account', record['parentId'] as string, 'pull', visited, self);
  }
  if (action === 'pull') {
    await traverseCategory(self, 'contacts',
      () => apiQuery<{ Id: string }>(`SELECT Id FROM Contact WHERE AccountId = '${id}'`),
      (c) => resolveAndSync('contact', c.Id, 'pull', visited, self).then(() => undefined));

    // The generic /v1/orders?accountId= filter is ignored server-side (observed on intQA:
    // byte-identical to the unfiltered tenant-wide list), so scope via the dedicated
    // subscriptionOwner endpoint instead. That endpoint takes the account NUMBER/key
    // (e.g. ACG00018042), not the internal id passed into rulesAccount — resolve it off
    // the already-fetched account record (basicInfo.accountNumber or accountNumber).
    const accountNumber = ((record['basicInfo'] as ResourceRecord | undefined)?.['accountNumber']
      ?? record['accountNumber']) as string | undefined;
    if (accountNumber) {
      await traverseCategory(self, 'orders',
        () => fetchAllItems<{ orderNumber: string }>(`/v1/orders/subscriptionOwner/${encodeURIComponent(accountNumber)}`, 'orders'),
        (o) => resolveAndSync('order', o.orderNumber, 'pull', visited, self).then(() => undefined));
    }
    // else: account record carries no number (unexpected for a real Zuora account GET
    // response) — skip order traversal for this node rather than fetch tenant-wide.

    await traverseCategory(self, 'subscriptions',
      () => fetchAllItems<{ id: string }>(`/v1/subscriptions/accounts/${id}`, 'subscriptions'),
      (s) => resolveAndSync('subscription', s.id, 'pull', visited, self).then(() => undefined));

    await traverseCategory(self, 'invoices',
      () => fetchAllItems<{ id: string }>(`/v1/transactions/invoices/accounts/${id}`, 'invoices'),
      (inv) => resolveAndSync('invoice', inv.id, 'pull', visited, self).then(() => undefined));

    await traverseCategory(self, 'credit-memos',
      () => fetchAllItems<{ id: string }>(`/v1/credit-memos?accountId=${id}`, 'creditmemos'),
      (cm) => resolveAndSync('credit-memo', cm.id, 'pull', visited, self).then(() => undefined));

    await traverseCategory(self, 'debit-memos',
      () => fetchAllItems<{ id: string }>(`/v1/debit-memos?accountId=${id}`, 'debitmemos'),
      (dm) => resolveAndSync('debit-memo', dm.id, 'pull', visited, self).then(() => undefined));

    await traverseCategory(self, 'bill-runs',
      () => apiQuery<{ Id: string }>(`SELECT Id FROM BillRun WHERE AccountId = '${id}'`),
      (br) => resolveAndSync('bill-run', br.Id, 'pull', visited, self).then(() => undefined));
  }
}

async function rulesContact(action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) {
      await resolveAndSync('account', record['accountId'] as string, 'pull', visited, self);
    }
  }
}

async function rulesOrder(_id: string, _action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  // GET /v1/orders/{orderNumber} wraps the order under an 'order' key; unwrap before
  // reading, same as the push path (src/commands/orders.ts: rawFull['order'] ?? rawFull).
  // Stay safe when there's no envelope (defensive/older shape).
  const o = (record['order'] as ResourceRecord | undefined) ?? record;

  // Order record uses existingAccountNumber; GET /v1/accounts/{accountNumber} returns the full account record
  const accountNumber = (o['existingAccountNumber'] ?? o['accountNumber']) as string | undefined;
  if (accountNumber) {
    try {
      const acctRecord = await apiGet<ResourceRecord>(`/v1/accounts/${accountNumber}`);
      const acctId = (acctRecord['basicInfo'] as ResourceRecord | undefined)?.['id'] as string | undefined;
      if (acctId) await resolveAndSync('account', acctId, 'pull', visited, self);
    } catch (err) {
      recordDependencyFailure(self, 'parent account', err);
    }
  }

  const items = (o['orderLineItems'] as Array<{ id: string }> | undefined) ?? [];
  for (const item of items) await resolveAndSync('order-line-item', item.id, 'pull', visited, self);

  const subs = (o['subscriptions'] as Array<{ subscriptionNumber: string }> | undefined) ?? [];
  for (const s of subs) await resolveAndSync('subscription', s.subscriptionNumber, 'pull', visited, self);
}

async function rulesOrderLineItem(action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['orderId']) {
      await resolveAndSync('order', record['orderId'] as string, action, visited, self);
    }
  }
}

async function rulesSubscription(action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited, self);
    if (record['orderNumber']) await resolveAndSync('order', record['orderNumber'] as string, 'pull', visited, self);
  }
}

async function rulesProduct(id: string, action: Action, _record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  await traverseCategory(self, 'product-rate-plans',
    () => apiQuery<{ Id: string }>(`SELECT Id FROM ProductRatePlan WHERE ProductId = '${id}'`),
    (plan) => resolveAndSync('product-rate-plan', plan.Id, action, visited, self).then(() => undefined));
}

async function rulesProductRatePlan(id: string, action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  // Object endpoint returns ProductId (PascalCase)
  const productId = (record['ProductId'] ?? record['productId']) as string | undefined;
  if (productId) await resolveAndSync('product', productId, 'pull', visited, self);

  if (action === 'pull') {
    await traverseCategory(self, 'product-rate-plan-charges',
      () => apiQuery<{ Id: string }>(`SELECT Id FROM ProductRatePlanCharge WHERE ProductRatePlanId = '${id}'`),
      (ch) => resolveAndSync('product-rate-plan-charge', ch.Id, 'pull', visited, self).then(() => undefined));
  }
}

async function rulesProductRatePlanCharge(_action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  // Object endpoint returns ProductRatePlanId (PascalCase)
  const prpId = (record['ProductRatePlanId'] ?? record['productRatePlanId']) as string | undefined;
  if (prpId) {
    await resolveAndSync('product-rate-plan', prpId, 'pull', visited, self);
  }
}

async function rulesInvoice(_id: string, action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited, self);
  }
  if (record['billRunId']) await resolveAndSync('bill-run', record['billRunId'] as string, 'pull', visited, self);
}

async function rulesCreditMemo(_id: string, action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited, self);
  }
  if (record['sourceId']) {
    await traverseCategory(self, 'bill-runs',
      () => apiQuery<{ Id: string }>(`SELECT Id FROM BillRun WHERE BillRunNumber = '${record['sourceId'] as string}'`),
      (br) => resolveAndSync('bill-run', br.Id, 'pull', visited, self).then(() => undefined));
  }
}

async function rulesDebitMemo(_id: string, action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited, self);
  }
}

async function rulesBillRun(id: string, action: Action, record: ResourceRecord, visited: Set<string>, self: Parent): Promise<void> {
  if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited, self);

  // Each child-lookup below is independently wrapped (via traverseCategory): intQA has been
  // observed to reject some of these ZOQL/GET calls with HTTP 400 (e.g. INVALID_TYPE on
  // Invoice/DebitMemo ZOQL), which would otherwise throw out of rulesBillRun and abort the
  // entire pull for any account that has bill-runs. Instead the whole category is recorded as
  // a dependency failure and traversal continues; the top-level pull emits a consolidated
  // "dependent objects of bill-run <id> were not pulled: …" warning.
  await traverseCategory(self, 'invoices',
    () => apiQuery<{ Id: string }>(`SELECT Id FROM Invoice WHERE BillRunId = '${id}'`),
    (inv) => resolveAndSync('invoice', inv.Id, action, visited, self).then(() => undefined));

  await traverseCategory(self, 'credit-memos',
    () => apiGet<{ creditMemos?: Array<{ id: string }> }>(`/v1/credit-memos?sourceId=${(record['billRunNumber'] as string) ?? id}`).then((r) => r.creditMemos ?? []),
    (cm) => resolveAndSync('credit-memo', cm.id, action, visited, self).then(() => undefined));

  await traverseCategory(self, 'debit-memos',
    () => apiQuery<{ Id: string }>(`SELECT Id FROM DebitMemo WHERE BillRunId = '${id}'`),
    (dm) => resolveAndSync('debit-memo', dm.Id, action, visited, self).then(() => undefined));
}
