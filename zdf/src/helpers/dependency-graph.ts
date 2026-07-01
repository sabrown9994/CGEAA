import { apiGet, apiQuery } from '../api/client.js';
import { writeResourceFile, deleteResourceFile } from './file-io.js';
import { output } from './output.js';

let noDependency = false;
export function setNoDependency(flag: boolean): void { noDependency = flag; }
export function isNoDependency(): boolean { return noDependency; }

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
  while (url) {
    const page = await apiGet<Record<string, unknown>>(url);
    const items = page[itemsKey] as T[] | undefined;
    if (items) all.push(...items);
    url = page['nextPage'] as string | undefined;
  }
  return all;
}

async function fetchAndWrite(resource: string, id: string): Promise<ResourceRecord | null> {
  const endpoint = ENDPOINTS[resource];
  if (!endpoint) return null;
  try {
    const data = await apiGet<ResourceRecord>(endpoint(id));
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
        'creditMemoItems'
      );
    } else if (resource === 'debit-memo') {
      record['debitMemoItems'] = await fetchAllItems(
        `/v1/debit-memos/${id}/items`,
        'debitMemoItems'
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

export async function resolveAndSync(
  resource: string,
  id: string,
  action: Action,
  visited: Set<string> = new Set()
): Promise<void> {
  const key = `${resource}:${id}`;
  if (visited.has(key)) return;
  visited.add(key);

  const record = await fetchAndWrite(resource, id);
  if (!record) return;

  if (!noDependency) {
    await applyRules(resource, id, action, record, visited);
  }
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

    const orders = await fetchAllItems<{ orderNumber: string }>(`/v1/orders?accountId=${id}`, 'orders');
    for (const o of orders) await resolveAndSync('order', o.orderNumber, 'pull', visited);

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
  // Order record uses existingAccountNumber; GET /v1/accounts/{accountNumber} returns the full account record
  const accountNumber = (record['existingAccountNumber'] ?? record['accountNumber']) as string | undefined;
  if (accountNumber) {
    const acctRecord = await apiGet<ResourceRecord>(`/v1/accounts/${accountNumber}`);
    const acctId = (acctRecord['basicInfo'] as ResourceRecord | undefined)?.['id'] as string | undefined;
    if (acctId) await resolveAndSync('account', acctId, 'pull', visited);
  }

  const items = (record['orderLineItems'] as Array<{ id: string }> | undefined) ?? [];
  for (const item of items) await resolveAndSync('order-line-item', item.id, 'pull', visited);

  const subs = (record['subscriptions'] as Array<{ subscriptionNumber: string }> | undefined) ?? [];
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

  const invIds = await apiQuery<{ Id: string }>(`SELECT Id FROM Invoice WHERE BillRunId = '${id}'`);
  for (const inv of invIds) await resolveAndSync('invoice', inv.Id, action, visited);

  const cmIds = await apiGet<{ creditMemos?: Array<{ id: string }> }>(`/v1/credit-memos?sourceId=${(record['billRunNumber'] as string) ?? id}`);
  for (const cm of cmIds.creditMemos ?? []) await resolveAndSync('credit-memo', cm.id, action, visited);

  const dmIds = await apiQuery<{ Id: string }>(`SELECT Id FROM DebitMemo WHERE BillRunId = '${id}'`);
  for (const dm of dmIds) await resolveAndSync('debit-memo', dm.Id, action, visited);
}
