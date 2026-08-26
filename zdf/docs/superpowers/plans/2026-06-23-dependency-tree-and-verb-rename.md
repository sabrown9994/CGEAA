# Dependency Tree, Verb Rename, and New Resources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `get`→`pull` and `update`→`push` across all commands, add 4 new billing resources, and build a dependency-tree engine that auto-fetches related objects after every action.

**Architecture:** A central `resolveAndSync(resource, id, action, visited)` function in `src/helpers/dependency-graph.ts` holds all relationship rules in a single registry. Each command calls it after its primary API action; a visited set (keyed `"resource:id"`) prevents circular traversal. The `--no-dependency` root flag bypasses traversal entirely.

**Tech Stack:** TypeScript, Commander.js, Axios via `src/api/client.ts`, Vitest, tsup (CJS output, Node16 module resolution, `.js` import extensions)

## Global Constraints

- All imports end with `.js` extension (Node16 CJS module resolution)
- CJS-compatible package versions: chalk@4, inquirer@8, ora@5
- Commander.js `getOrCreate` pattern for nested subcommands (verb parent → resource subcommand)
- Vitest mocks use `vi.hoisted(() => vi.fn())` pattern; mock variables declared before `vi.mock()`
- `runCommand(program, fn)` wraps every command action
- `assertSuccess(res, label)` checks `res.success` on all write operations
- `filterUpdatableFields(resource, data)` strips read-only and null fields
- `writeResourceFile` does full-file replacement (delete + write)
- Build: `tsup bin/zdf.ts --format cjs --out-dir dist`
- All existing tests must pass after each task

---

## File Map

**Modified:**
- `src/commands/accounts.ts` — rename `get`→`pull`, `update`→`push`; wire `resolveAndSync`
- `src/commands/contacts.ts` — same
- `src/commands/subscriptions.ts` — same; embed `ratePlans[]` in pull
- `src/commands/products.ts` — same
- `src/commands/product-rate-plans.ts` — same
- `src/commands/product-rate-plan-charges.ts` — same
- `src/commands/workflows.ts` — same (rename only)
- `src/commands/billing-templates.ts` — same (rename only)
- `src/commands/data-queries.ts` — same (rename only)
- `src/commands/orders.ts` — same; wire `resolveAndSync`
- `src/api/client.ts` — add `apiQuery<T>(zoql)`
- `src/helpers/updatable-fields.ts` — add `invoice`, `credit-memo`, `debit-memo` entries
- `src/constants.ts` — add 4 new `RESOURCE_SUBFOLDERS` entries
- `bin/zdf.ts` — add `--no-dependency` flag; register 4 new commands
- All test files under `src/__tests__/commands/` — update verb strings; add `apiQuery: vi.fn()` to mock

**Created:**
- `src/helpers/dependency-graph.ts` — `resolveAndSync` engine + full rule registry
- `src/commands/invoices.ts`
- `src/commands/credit-memos.ts`
- `src/commands/debit-memos.ts`
- `src/commands/bill-runs.ts`
- `src/__tests__/helpers/dependency-graph.test.ts`
- `src/__tests__/commands/invoices.test.ts`
- `src/__tests__/commands/credit-memos.test.ts`
- `src/__tests__/commands/debit-memos.test.ts`
- `src/__tests__/commands/bill-runs.test.ts`

---

### Task 1: Rename `get`→`pull` and `update`→`push` across all command files and tests

**Files:**
- Modify: `src/commands/accounts.ts`, `contacts.ts`, `subscriptions.ts`, `products.ts`, `product-rate-plans.ts`, `product-rate-plan-charges.ts`, `workflows.ts`, `billing-templates.ts`, `data-queries.ts`, `orders.ts`
- Modify: all 5 test files under `src/__tests__/commands/`

**Interfaces:**
- Produces: `pull` and `push` parent commands registered on `program` (replacing `get` and `update`)

- [ ] **Step 1: Update `src/commands/accounts.ts`**

Replace the `getOrCreate` calls and descriptions:

```typescript
const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');
```

Replace `getCmd` → `pullCmd` and `updateCmd` → `pushCmd` throughout the file. Update command descriptions to say "Fetch" and "Update" respectively. Update `output.success` messages to say "Account pulled" / "Account pushed" where appropriate (keep the existing wording — only the verb command names change; success messages can stay as-is).

- [ ] **Step 2: Apply the same rename to the remaining 9 command files**

For each of `contacts.ts`, `subscriptions.ts`, `products.ts`, `product-rate-plans.ts`, `product-rate-plan-charges.ts`, `workflows.ts`, `billing-templates.ts`, `data-queries.ts`, `orders.ts`:
- Replace `getOrCreate(program, 'get', ...)` → `getOrCreate(program, 'pull', ...)`
- Replace `getOrCreate(program, 'update', ...)` → `getOrCreate(program, 'push', ...)`
- Replace all `getCmd` variable references → `pullCmd`
- Replace all `updateCmd` variable references → `pushCmd`

- [ ] **Step 3: Update test files — accounts.test.ts**

In `src/__tests__/commands/accounts.test.ts`:
- Change `'get', 'account'` → `'pull', 'account'`
- Change `'update', 'account'` → `'push', 'account'`
- Change describe block names: `'zdf get account'` → `'zdf pull account'`, `'zdf update account'` → `'zdf push account'`

```typescript
// Before:
await makeProgram().parseAsync(['node', 'zdf', 'get', 'account', 'acc-1']);
// After:
await makeProgram().parseAsync(['node', 'zdf', 'pull', 'account', 'acc-1']);

// Before:
await makeProgram().parseAsync(['node', 'zdf', 'update', 'account', 'acc-1']);
// After:
await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
```

- [ ] **Step 4: Update remaining 4 test files**

Apply the same `get`→`pull` and `update`→`push` substitution in `contacts.test.ts`, `subscriptions.test.ts`, `orders.test.ts`, and `data-queries.test.ts`.

- [ ] **Step 5: Run tests and verify all pass**

```bash
npx vitest run
```
Expected: all existing tests pass (the test infrastructure itself doesn't care about verb names — only the `parseAsync` strings matter).

- [ ] **Step 6: Commit**

```bash
git add src/commands/ src/__tests__/commands/
git commit -m "feat: rename get→pull and update→push verbs across all command files"
```

---

### Task 2: Add `apiQuery<T>(zoql)` to `src/api/client.ts`

**Files:**
- Modify: `src/api/client.ts`
- Modify: all test files that mock `../../api/client.js` — add `apiQuery: vi.fn()` to mock factory

**Interfaces:**
- Produces: `export async function apiQuery<T>(zoql: string): Promise<T[]>`
- The response from Zuora `POST /v1/action/query` has shape `{ records: T[]; size: number; done: boolean }`

- [ ] **Step 1: Add `apiQuery` to `src/api/client.ts`**

Append after the existing export lines (line 63):

```typescript
export async function apiQuery<T>(zoql: string): Promise<T[]> {
  const res = await request<{ records: T[]; size: number; done: boolean }>(
    'POST',
    '/v1/action/query',
    { queryString: zoql }
  );
  return res.records ?? [];
}
```

- [ ] **Step 2: Add `apiQuery: vi.fn()` to all command test mock factories**

In each of `accounts.test.ts`, `contacts.test.ts`, `subscriptions.test.ts`, `orders.test.ts`, `data-queries.test.ts`, update the `vi.mock('../../api/client.js', ...)` call:

```typescript
// Before:
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, setDebug: vi.fn() }));
// After:
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn() }));
```

(The `mockQuery` variable must be declared with `vi.hoisted` above the `vi.mock` call.)

- [ ] **Step 3: Run tests**

```bash
npx vitest run
```
Expected: all tests pass (no test calls `apiQuery` yet — the mock just needs to exist to avoid "No export" errors when the dependency graph eventually imports it).

- [ ] **Step 4: Commit**

```bash
git add src/api/client.ts src/__tests__/commands/
git commit -m "feat: add apiQuery ZOQL helper to api client"
```

---

### Task 3: Build `src/helpers/dependency-graph.ts`

**Files:**
- Create: `src/helpers/dependency-graph.ts`
- Create: `src/__tests__/helpers/dependency-graph.test.ts`

**Interfaces:**
- Consumes: `apiGet` from `../api/client.js`, `apiQuery` from `../api/client.js`, `writeResourceFile`, `deleteResourceFile` from `../helpers/file-io.js`, `output` from `../helpers/output.js`
- Produces:
  ```typescript
  export async function resolveAndSync(
    resource: string,
    id: string,
    action: 'pull' | 'push' | 'delete',
    visited?: Set<string>
  ): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/helpers/dependency-graph.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockWrite = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiQuery: mockQuery, setDebug: vi.fn() }));
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, deleteResourceFile: mockDeleteFile }));
vi.mock('../../helpers/output.js', () => ({ output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import { resolveAndSync } from '../../helpers/dependency-graph.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('resolveAndSync visited-set loop prevention', () => {
  it('skips a resource+id pair already in the visited set', async () => {
    const visited = new Set(['account:ACC-001']);
    await resolveAndSync('account', 'ACC-001', 'pull', visited);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('resolveAndSync contact pull — no dependencies', () => {
  it('adds contact to visited set and fetches nothing else', async () => {
    mockGet.mockResolvedValue({ id: 'CON-001', accountId: 'ACC-001', success: true });
    const visited = new Set<string>();
    await resolveAndSync('contact', 'CON-001', 'pull', visited);
    expect(mockGet).toHaveBeenCalledWith('/v1/contacts/CON-001');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(visited.has('contact:CON-001')).toBe(true);
  });
});

describe('resolveAndSync contact push — re-fetches parent account', () => {
  it('fetches contact then re-fetches parent account', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'CON-001', accountId: 'ACC-001', success: true }) // contact
      .mockResolvedValueOnce({ id: 'ACC-001', name: 'Acme', success: true });          // account
    mockQuery.mockResolvedValue([]);
    await resolveAndSync('contact', 'CON-001', 'push', new Set());
    expect(mockGet).toHaveBeenNthCalledWith(1, '/v1/contacts/CON-001');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/accounts/ACC-001');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/__tests__/helpers/dependency-graph.test.ts
```
Expected: FAIL — `../../helpers/dependency-graph.js` not found.

- [ ] **Step 3: Create `src/helpers/dependency-graph.ts`**

```typescript
import { apiGet, apiQuery } from '../api/client.js';
import { writeResourceFile, deleteResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';

type Action = 'pull' | 'push' | 'delete';

interface ResourceRecord extends Record<string, unknown> {
  success?: boolean;
}

async function fetchAndWrite(resource: string, id: string): Promise<ResourceRecord | null> {
  const endpoint = ENDPOINTS[resource];
  if (!endpoint) return null;
  try {
    const data = await apiGet<ResourceRecord>(endpoint(id));
    const { success: _s, ...record } = data;
    writeResourceFile(resource, id, record);
    return record;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) { deleteResourceFile(resource, id); return null; }
    output.warn(`Failed to re-fetch ${resource} ${id}: ${(err as Error).message}`);
    return null;
  }
}

const ENDPOINTS: Record<string, (id: string) => string> = {
  account: (id) => `/v1/accounts/${id}`,
  contact: (id) => `/v1/contacts/${id}`,
  subscription: (id) => `/v1/subscriptions/${id}`,
  order: (id) => `/v1/orders/${id}`,
  'order-line-item': (id) => `/v1/order-line-items/${id}`,
  product: (id) => `/v1/catalog/product/${id}`,
  'product-rate-plan': (id) => `/v1/ratedPlans/${id}`,
  'product-rate-plan-charge': (id) => `/v1/ratedPlanCharges/${id}`,
  invoice: (id) => `/v1/invoices/${id}`,
  'credit-memo': (id) => `/v1/credit-memos/${id}`,
  'debit-memo': (id) => `/v1/debit-memos/${id}`,
  'bill-run': (id) => `/v1/bill-runs/${id}`,
};

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

  await applyRules(resource, id, action, record, visited);
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
    case 'product-rate-plan': await rulesProductRatePlan(action, record, visited); break;
    case 'product-rate-plan-charge': await rulesProductRatePlanCharge(action, record, visited); break;
    case 'invoice': await rulesInvoice(id, action, record, visited); break;
    case 'credit-memo': await rulesCreditMemo(id, action, record, visited); break;
    case 'debit-memo': await rulesDebitMemo(id, action, record, visited); break;
    case 'bill-run': await rulesBillRun(id, action, record, visited); break;
  }
}

async function rulesAccount(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  // upstream: parent account if parentId exists
  if (record['parentId']) {
    await resolveAndSync('account', record['parentId'] as string, action, visited);
  }
  if (action === 'pull') {
    // downstream: contacts (ZOQL), orders, subscriptions, invoices, credit-memos, debit-memos, bill-runs (ZOQL)
    const contactIds = await apiQuery<{ Id: string }>(`SELECT Id FROM Contact WHERE AccountId = '${id}'`);
    for (const c of contactIds) await resolveAndSync('contact', c.Id, 'pull', visited);

    const orders = await apiGet<{ orders?: Array<{ orderNumber: string }> }>(`/v1/orders/account/${id}`);
    for (const o of orders.orders ?? []) await resolveAndSync('order', o.orderNumber, 'pull', visited);

    const subs = await apiGet<{ subscriptions?: Array<{ id: string }> }>(`/v1/subscriptions/accounts/${id}`);
    for (const s of subs.subscriptions ?? []) await resolveAndSync('subscription', s.id, 'pull', visited);

    const invs = await apiGet<{ invoices?: Array<{ id: string }> }>(`/v1/invoices?accountId=${id}`);
    for (const inv of invs.invoices ?? []) await resolveAndSync('invoice', inv.id, 'pull', visited);

    const cms = await apiGet<{ creditMemos?: Array<{ id: string }> }>(`/v1/credit-memos?accountId=${id}`);
    for (const cm of cms.creditMemos ?? []) await resolveAndSync('credit-memo', cm.id, 'pull', visited);

    const dms = await apiGet<{ debitMemos?: Array<{ id: string }> }>(`/v1/debit-memos?accountId=${id}`);
    for (const dm of dms.debitMemos ?? []) await resolveAndSync('debit-memo', dm.id, 'pull', visited);

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

async function rulesOrder(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  // always re-fetch parent account
  if (record['accountNumber']) {
    // need accountId — fetch account by number
    const acctList = await apiGet<{ accounts?: Array<{ id: string }> }>(`/v1/accounts?accountNumber=${record['accountNumber'] as string}`);
    const acctId = acctList.accounts?.[0]?.id;
    if (acctId) await resolveAndSync('account', acctId, 'pull', visited);
  }

  // downstream: order-line-items and subscriptions
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
  // ratePlans are inline in the subscription response — already embedded by the subscription command
}

async function rulesProduct(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  const plans = await apiGet<{ productRatePlans?: Array<{ id: string }> }>(`/v1/catalog/product/${id}/productRatePlans`);
  for (const plan of plans.productRatePlans ?? []) {
    await resolveAndSync('product-rate-plan', plan.id, action, visited);
  }
}

async function rulesProductRatePlan(action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (record['productId']) await resolveAndSync('product', record['productId'] as string, 'pull', visited);
}

async function rulesProductRatePlanCharge(action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (record['productRatePlanId']) {
    await resolveAndSync('product-rate-plan', record['productRatePlanId'] as string, action, visited);
  }
}

async function rulesInvoice(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
  }
  if (record['billRunId']) await resolveAndSync('bill-run', record['billRunId'] as string, 'pull', visited);
}

async function rulesCreditMemo(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
  }
  if (record['sourceId']) {
    // sourceId is the billRunNumber — look up the bill run
    const brs = await apiQuery<{ Id: string }>(`SELECT Id FROM BillRun WHERE BillRunNumber = '${record['sourceId'] as string}'`);
    for (const br of brs) await resolveAndSync('bill-run', br.Id, 'pull', visited);
  }
}

async function rulesDebitMemo(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (action === 'push' || action === 'delete') {
    if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);
  }
}

async function rulesBillRun(id: string, action: Action, record: ResourceRecord, visited: Set<string>): Promise<void> {
  if (record['accountId']) await resolveAndSync('account', record['accountId'] as string, 'pull', visited);

  const invIds = await apiQuery<{ Id: string }>(`SELECT Id FROM Invoice WHERE BillRunId = '${id}'`);
  for (const inv of invIds) await resolveAndSync('invoice', inv.Id, action, visited);

  const cmIds = await apiGet<{ creditMemos?: Array<{ id: string }> }>(`/v1/credit-memos?sourceId=${record['billRunNumber'] as string ?? id}`);
  for (const cm of cmIds.creditMemos ?? []) await resolveAndSync('credit-memo', cm.id, action, visited);

  const dmIds = await apiQuery<{ Id: string }>(`SELECT Id FROM DebitMemo WHERE BillRunId = '${id}'`);
  for (const dm of dmIds) await resolveAndSync('debit-memo', dm.Id, action, visited);
}
```

**Note:** `deleteResourceFile` needs to be added to `src/helpers/file-io.ts` if it doesn't already exist. Check `src/helpers/file-io.ts` — if it only has `writeResourceFile`, `readResourceFile`, and `renameResourceFile`, add:

```typescript
export function deleteResourceFile(resource: string, id: string): void {
  const filePath = path.join(OUTPUT_DIR, RESOURCE_SUBFOLDERS[resource] ?? resource, `${id}.json`);
  if (existsSync(filePath)) unlinkSync(filePath);
}
```

(Import `existsSync`, `unlinkSync` from `'fs'` and `path` from `'path'` if not already imported.)

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/__tests__/helpers/dependency-graph.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/dependency-graph.ts src/helpers/file-io.ts src/__tests__/helpers/dependency-graph.test.ts
git commit -m "feat: add dependency-graph engine with resolveAndSync and full rule registry"
```

---

### Task 4: Add `--no-dependency` flag to `bin/zdf.ts`

**Files:**
- Modify: `bin/zdf.ts`
- Modify: `src/helpers/dependency-graph.ts` — export `setNoDependency(flag: boolean)`

**Interfaces:**
- Produces: `export function setNoDependency(flag: boolean): void` and `export function isNoDependency(): boolean` in `dependency-graph.ts`

- [ ] **Step 1: Add `--no-dependency` flag to `bin/zdf.ts`**

```typescript
program
  .name('zdf')
  .description('Zuora Development Framework CLI')
  .version('1.0.0')
  .option('--debug', 'print full stack traces on error')
  .option('--no-dependency', 'skip dependency tree traversal');
```

- [ ] **Step 2: Add `setNoDependency` and `isNoDependency` to `dependency-graph.ts`**

Add at the top of the file, after the imports:

```typescript
let noDependency = false;
export function setNoDependency(flag: boolean): void { noDependency = flag; }
export function isNoDependency(): boolean { return noDependency; }
```

Wrap the `applyRules` call in `resolveAndSync` with a guard:

```typescript
const record = await fetchAndWrite(resource, id);
if (!record) return;

if (!noDependency) {
  await applyRules(resource, id, action, record, visited);
}
```

- [ ] **Step 3: Wire `setNoDependency` into `command-runner.ts`**

In `src/helpers/command-runner.ts`, import and call it alongside `setDebug`:

```typescript
import { setDebug } from '../api/client.js';
import { setNoDependency } from './dependency-graph.js';

export function runCommand(program: Command, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const debug = program.opts().debug as boolean | undefined;
    const noDep = program.opts().noDependency as boolean | undefined;
    setDebug(!!debug);
    setNoDependency(!!noDep);
    // ... rest unchanged
  };
}
```

- [ ] **Step 4: Add `setNoDependency: vi.fn()` to dependency-graph mock in any test that mocks it**

(No tests mock `dependency-graph.ts` yet — this step is a no-op for now. Add the mock when wiring commands in Task 5.)

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add bin/zdf.ts src/helpers/dependency-graph.ts src/helpers/command-runner.ts
git commit -m "feat: add --no-dependency flag to skip dependency traversal"
```

---

### Task 5: Wire `resolveAndSync` into existing command files

**Files:**
- Modify: `src/commands/accounts.ts`, `contacts.ts`, `subscriptions.ts`, `orders.ts`, `products.ts`, `product-rate-plans.ts`, `product-rate-plan-charges.ts`
- Modify: corresponding test files — add `dependency-graph.js` mock

**Interfaces:**
- Consumes: `resolveAndSync` from `../helpers/dependency-graph.js`

- [ ] **Step 1: Update `src/commands/accounts.ts`**

Add import at top:
```typescript
import { resolveAndSync } from '../helpers/dependency-graph.js';
```

In the `pull account` action, call `resolveAndSync` after the primary fetch:
```typescript
pullCmd
  .command('account <id>')
  .description('Fetch an account from Zuora by internal ID')
  .action((id: string) =>
    runCommand(program, async () => {
      await resolveAndSync('account', id, 'pull');
      output.success(`Account ${id} written to zdf-output/accounts/${id}.json`);
    })()
  );
```

In `push account`:
```typescript
// After assertSuccess:
await resolveAndSync('account', id, 'push');
```

In `delete account`:
```typescript
// After assertSuccess:
await resolveAndSync('account', id, 'delete');
```

**Important:** The `pull account` action body changes significantly — `resolveAndSync` now handles the fetch+write. Remove the direct `apiGet` + `writeResourceFile` calls from the pull action body; `resolveAndSync` does both.

- [ ] **Step 2: Update `accounts.test.ts` to mock `dependency-graph.js`**

Add to top of `accounts.test.ts`:
```typescript
const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
}));
```

Update pull test to assert `resolveAndSync` is called instead of direct `apiGet`:
```typescript
describe('zdf pull account', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'account', 'acc-1']);
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'pull');
  });
});
```

Update push and delete tests similarly.

- [ ] **Step 3: Apply same pattern to `contacts.ts` and `contacts.test.ts`**

Contact pull: call `resolveAndSync('contact', id, 'pull')`.
Contact push: call `resolveAndSync('contact', id, 'push')`.
Contact delete: call `resolveAndSync('contact', id, 'delete')`.

- [ ] **Step 4: Apply same pattern to `orders.ts` and `orders.test.ts`**

Order pull (was `get`): `resolveAndSync('order', id, 'pull')`.
Order push (was `update`): `resolveAndSync('order', id, 'push')`.
Order delete: `resolveAndSync('order', id, 'delete')`.
Order line item push: `resolveAndSync('order-line-item', id, 'push')`.

- [ ] **Step 5: Apply same pattern to `subscriptions.ts`, `products.ts`, `product-rate-plans.ts`, `product-rate-plan-charges.ts` and their test files**

Each gets the same import + `resolveAndSync` calls replacing direct `apiGet`/`writeResourceFile` in pull actions.

- [ ] **Step 6: Run tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/commands/ src/__tests__/commands/
git commit -m "feat: wire resolveAndSync dependency traversal into all existing command files"
```

---

### Task 6: Add new command files — invoices, credit-memos, debit-memos, bill-runs

**Files:**
- Create: `src/commands/invoices.ts`, `credit-memos.ts`, `debit-memos.ts`, `bill-runs.ts`
- Create: `src/__tests__/commands/invoices.test.ts`, `credit-memos.test.ts`, `debit-memos.test.ts`, `bill-runs.test.ts`

**Interfaces:**
- Each exports `register(program: Command): void`
- Invoice pull fetches `GET /v1/invoices/{id}`, then `GET /v1/invoices/{id}/items` (paginated), embeds items + taxation items inline, writes single file
- Credit memo pull: same with `GET /v1/credit-memos/{id}` + `GET /v1/credit-memos/{id}/items`
- Debit memo pull: same with `GET /v1/debit-memos/{id}` + `GET /v1/debit-memos/{id}/items`
- Bill run push: re-fetches (no PUT endpoint) — calls `resolveAndSync('bill-run', id, 'pull')`

- [ ] **Step 1: Write failing tests for invoices**

Create `src/__tests__/commands/invoices.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn() }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
}));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, deleteResourceFile: vi.fn() }));
vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import { register } from '../../commands/invoices.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull invoice', () => {
  it('calls resolveAndSync with pull', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'invoice', 'INV-001']);
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'pull');
  });
});

describe('zdf push invoice', () => {
  it('reads file, puts to Zuora', async () => {
    mockRead.mockReturnValue({ id: 'INV-001', invoiceItems: [{ id: 'item-1', amount: 100 }] });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/invoices/INV-001', expect.any(Object));
  });
});

describe('zdf delete invoice', () => {
  it('calls delete and resolveAndSync with delete', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/invoices/INV-001');
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'delete');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/__tests__/commands/invoices.test.ts
```
Expected: FAIL — `../../commands/invoices.js` not found.

- [ ] **Step 3: Create `src/commands/invoices.ts`**

```typescript
import { Command } from 'commander';
import { apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'invoice';
const ENDPOINT = '/v1/invoices';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('invoice <id>')
    .description('Fetch an invoice from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Invoice ${id} written to zdf-output/invoices/${id}.json`);
      })()
    );

  pushCmd
    .command('invoice <id>')
    .description('Update an invoice in Zuora from a local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, fileData);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'invoice push');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Invoice ${id} updated.`);
      })()
    );

  deleteCmd
    .command('invoice <id>')
    .description('Delete an invoice in Zuora')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse & { jobId?: string }>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'invoice delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Invoice ${id} deleted.`);
      })()
    );
}
```

**Note on async delete:** The basic delete above handles synchronous deletes. Task 10 handles the async (`jobId`) case.

- [ ] **Step 4: Create `src/commands/credit-memos.ts`**

```typescript
import { Command } from 'commander';
import { apiPut, apiDelete } from '../api/client.js';
import { readResourceFile } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'credit-memo';
const ENDPOINT = '/v1/credit-memos';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('credit-memo <id>')
    .description('Fetch a credit memo from Zuora by ID, including all line items')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Credit memo ${id} written to zdf-output/credit-memos/${id}.json`);
      })()
    );

  pushCmd
    .command('credit-memo <id>')
    .description('Update a credit memo in Zuora from a local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const fileData = readResourceFile(RESOURCE, id) as Record<string, unknown>;
        const body = filterUpdatableFields(RESOURCE, fileData);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'credit-memo push');
        await resolveAndSync(RESOURCE, id, 'push');
        output.success(`Credit memo ${id} updated.`);
      })()
    );

  deleteCmd
    .command('credit-memo <id>')
    .description('Delete a credit memo in Zuora (must be Draft status)')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'credit-memo delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Credit memo ${id} deleted.`);
      })()
    );
}
```

- [ ] **Step 5: Create `src/commands/debit-memos.ts`**

Same structure as credit-memos with `RESOURCE = 'debit-memo'` and `ENDPOINT = '/v1/debit-memos'`. Delete description: "must be Canceled status".

- [ ] **Step 6: Create `src/commands/bill-runs.ts`**

```typescript
import { Command } from 'commander';
import { apiDelete } from '../api/client.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { resolveAndSync } from '../helpers/dependency-graph.js';

const RESOURCE = 'bill-run';
const ENDPOINT = '/v1/bill-runs';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('bill-run <id>')
    .description('Fetch a bill run from Zuora by ID')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Bill run ${id} written to zdf-output/bill-runs/${id}.json`);
      })()
    );

  pushCmd
    .command('bill-run <id>')
    .description('Re-fetch a bill run from Zuora (no PUT endpoint; overwrites local file with latest data)')
    .action((id: string) =>
      runCommand(program, async () => {
        await resolveAndSync(RESOURCE, id, 'pull');
        output.success(`Bill run ${id} re-fetched and written to zdf-output/bill-runs/${id}.json`);
      })()
    );

  deleteCmd
    .command('bill-run <id>')
    .description('Delete a bill run in Zuora (must be Canceled or Error status)')
    .action((id: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${id}`);
        assertSuccess(res, 'bill-run delete');
        await resolveAndSync(RESOURCE, id, 'delete');
        output.success(`Bill run ${id} deleted.`);
      })()
    );
}
```

- [ ] **Step 7: Write and run tests for credit-memos, debit-memos, bill-runs**

Create `src/__tests__/commands/credit-memos.test.ts`, `debit-memos.test.ts`, and `bill-runs.test.ts` following the exact same pattern as `invoices.test.ts` above, substituting resource names and endpoints.

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/commands/invoices.ts src/commands/credit-memos.ts src/commands/debit-memos.ts src/commands/bill-runs.ts src/__tests__/commands/
git commit -m "feat: add invoice, credit-memo, debit-memo, bill-run command files"
```

---

### Task 7: Add `filterUpdatableFields` entries for invoice, credit-memo, debit-memo

**Files:**
- Modify: `src/helpers/updatable-fields.ts`

**Interfaces:**
- Produces: allowlists for `invoice`, `credit-memo`, `debit-memo` keys in `UPDATABLE_FIELDS`
- The `invoiceItems`, `creditMemoItems`, `debitMemoItems` arrays are included (the embedded items are sent as part of the push body)

- [ ] **Step 1: Add entries to `UPDATABLE_FIELDS` in `src/helpers/updatable-fields.ts`**

Add after the `'order-line-item'` entry:

```typescript
invoice: [
  'dueDate',
  'invoiceDate',
  'paymentTerm',
  'transferredToAccounting',
  'invoiceItems',
  'comments',
  'autoPay',
  'autoPayAmount',
  'targetDate',
],
'credit-memo': [
  'autoApplyUponPosting',
  'comment',
  'creditMemoDate',
  'excludeFromAutoApplyRules',
  'reasonCode',
  'transferredToAccounting',
  'creditMemoItems',
],
'debit-memo': [
  'autoPay',
  'comment',
  'debitMemoDate',
  'dueDate',
  'paymentTerm',
  'reasonCode',
  'transferredToAccounting',
  'debitMemoItems',
],
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/helpers/updatable-fields.ts
git commit -m "feat: add filterUpdatableFields entries for invoice, credit-memo, debit-memo"
```

---

### Task 8: Add new `RESOURCE_SUBFOLDERS` entries and register new commands in `bin/zdf.ts`

**Files:**
- Modify: `src/constants.ts`
- Modify: `bin/zdf.ts`

- [ ] **Step 1: Add entries to `RESOURCE_SUBFOLDERS` in `src/constants.ts`**

```typescript
export const RESOURCE_SUBFOLDERS: Record<string, string> = {
  account: 'accounts',
  contact: 'contacts',
  subscription: 'subscriptions',
  product: 'products',
  'product-rate-plan': 'product-rate-plans',
  'product-rate-plan-charge': 'product-rate-plan-charges',
  workflow: 'workflows',
  'billing-template': 'billing-templates',
  'data-query': 'data-queries',
  order: 'orders',
  'order-line-item': 'order-line-items',
  invoice: 'invoices',
  'credit-memo': 'credit-memos',
  'debit-memo': 'debit-memos',
  'bill-run': 'bill-runs',
};
```

- [ ] **Step 2: Register new commands in `bin/zdf.ts`**

```typescript
import { register as registerInvoices } from '../src/commands/invoices.js';
import { register as registerCreditMemos } from '../src/commands/credit-memos.js';
import { register as registerDebitMemos } from '../src/commands/debit-memos.js';
import { register as registerBillRuns } from '../src/commands/bill-runs.js';

// ... after existing registerOrders(program):
registerInvoices(program);
registerCreditMemos(program);
registerDebitMemos(program);
registerBillRuns(program);
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts bin/zdf.ts
git commit -m "feat: register invoice, credit-memo, debit-memo, bill-run commands and add RESOURCE_SUBFOLDERS entries"
```

---

### Task 9: Update subscription pull to embed `ratePlans[]` inline

**Files:**
- Modify: `src/helpers/dependency-graph.ts` — update `fetchAndWrite` for `subscription` to embed rate plans
- Modify: `src/__tests__/helpers/dependency-graph.test.ts` — add subscription embed test

**Background:** The Zuora `GET /v1/subscriptions/{id}` response already includes `ratePlans[]` with nested `ratePlanCharges[]`. The current `fetchAndWrite` strips `success` but otherwise writes the full response. This means rate plans are already embedded — verify this is the case rather than adding extra fetch logic.

- [ ] **Step 1: Verify the subscription response shape**

Read the spec section on subscription file shape. The Zuora subscription GET response includes `ratePlans` inline. The `fetchAndWrite` function already writes the full record minus `success`, so `ratePlans` will be present automatically. No code change is needed if `ratePlans` is returned by the Zuora API directly.

- [ ] **Step 2: Add a test verifying ratePlans are embedded**

In `src/__tests__/helpers/dependency-graph.test.ts`, add:

```typescript
describe('resolveAndSync subscription pull — embeds ratePlans inline', () => {
  it('writes subscription with ratePlans from Zuora response', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'SUB-001',
      accountId: 'ACC-001',
      ratePlans: [{ id: 'rp-1', ratePlanCharges: [{ id: 'rpc-1', name: 'Monthly Fee' }] }],
      success: true,
    });
    await resolveAndSync('subscription', 'SUB-001', 'pull', new Set(['account:ACC-001']));
    expect(mockWrite).toHaveBeenCalledWith('subscription', 'SUB-001', expect.objectContaining({
      ratePlans: [expect.objectContaining({ id: 'rp-1' })],
    }));
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/__tests__/helpers/dependency-graph.test.ts
```
Expected: passes (ratePlans already embedded by `fetchAndWrite`).

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/helpers/dependency-graph.test.ts
git commit -m "test: verify subscription pull embeds ratePlans inline"
```

---

### Task 10: Handle async invoice delete

**Files:**
- Modify: `src/commands/invoices.ts` — poll `GET /v1/async-jobs/{jobId}` when delete returns `jobId`
- Modify: `src/__tests__/commands/invoices.test.ts` — add async delete test

**Background:** Zuora's `DELETE /v1/invoices/{id}` returns `{ success: true }` for <100 items (synchronous) or `{ success: true, jobId: "xxx" }` for ≥100 items (async). When `jobId` is present, poll `GET /v1/async-jobs/{jobId}` until `jobStatus === 'Completed'`.

- [ ] **Step 1: Add async delete test**

In `src/__tests__/commands/invoices.test.ts`, add:

```typescript
describe('zdf delete invoice — async (jobId returned)', () => {
  it('polls async-jobs endpoint until Completed', async () => {
    mockDelete.mockResolvedValue({ success: true, jobId: 'job-123' });
    mockGet
      .mockResolvedValueOnce({ jobStatus: 'Processing' })
      .mockResolvedValueOnce({ jobStatus: 'Completed' });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);
    expect(mockGet).toHaveBeenCalledWith('/v1/async-jobs/job-123');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'INV-001', 'delete');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/__tests__/commands/invoices.test.ts
```
Expected: the new async test FAILS (no polling logic yet).

- [ ] **Step 3: Update `src/commands/invoices.ts` delete action**

```typescript
import { apiGet, apiPut, apiDelete } from '../api/client.js';

// In the delete action:
deleteCmd
  .command('invoice <id>')
  .description('Delete an invoice in Zuora')
  .action((id: string) =>
    runCommand(program, async () => {
      const res = await apiDelete<ZuoraWriteResponse & { jobId?: string }>(`${ENDPOINT}/${id}`);
      assertSuccess(res, 'invoice delete');
      if (res.jobId) {
        output.info(`Async delete started. Job ID: ${res.jobId}. Polling for completion...`);
        await pollAsyncJob(res.jobId);
      }
      await resolveAndSync(RESOURCE, id, 'delete');
      output.success(`Invoice ${id} deleted.`);
    })()
  );
```

Add the `pollAsyncJob` helper at the bottom of `invoices.ts`:

```typescript
async function pollAsyncJob(jobId: string): Promise<void> {
  const POLL_INTERVAL_MS = 2000;
  const MAX_ATTEMPTS = 30;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const job = await apiGet<{ jobStatus: string }>(`/v1/async-jobs/${jobId}`);
    if (job.jobStatus === 'Completed') return;
    if (job.jobStatus === 'Failed') throw new Error(`Async delete job ${jobId} failed.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Async delete job ${jobId} timed out after ${MAX_ATTEMPTS} attempts.`);
}
```

**Note for tests:** The `setTimeout` call will cause test slowness. In the test, mock `setTimeout` globally or use `vi.useFakeTimers()`. Alternatively, keep the test as-is since `POLL_INTERVAL_MS = 2000` is only called in real execution — but if the test hangs, add `vi.useFakeTimers()` / `vi.advanceTimersByTime(4000)` around the assertion.

- [ ] **Step 4: Update the async delete test to handle timers**

```typescript
describe('zdf delete invoice — async (jobId returned)', () => {
  it('polls async-jobs endpoint until Completed', async () => {
    vi.useFakeTimers();
    mockDelete.mockResolvedValue({ success: true, jobId: 'job-123' });
    mockGet
      .mockResolvedValueOnce({ jobStatus: 'Processing' })
      .mockResolvedValueOnce({ jobStatus: 'Completed' });
    mockResolve.mockResolvedValue(undefined);
    const promise = makeProgram().parseAsync(['node', 'zdf', 'delete', 'invoice', 'INV-001']);
    await vi.runAllTimersAsync();
    await promise;
    expect(mockGet).toHaveBeenCalledWith('/v1/async-jobs/job-123');
    expect(mockGet).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/__tests__/commands/invoices.test.ts
```
Expected: all invoice tests pass.

- [ ] **Step 6: Run full suite**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/commands/invoices.ts src/__tests__/commands/invoices.test.ts
git commit -m "feat: handle async invoice delete by polling async-jobs endpoint"
```

---

### Task 11: Full test suite verification and build

**Files:**
- No new files — verification task only

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass. If any fail, fix before proceeding.

- [ ] **Step 2: Build**

```bash
npx tsup bin/zdf.ts --format cjs --out-dir dist
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Smoke test the built CLI**

```bash
node dist/zdf.js --help
node dist/zdf.js pull --help
node dist/zdf.js push --help
```
Expected: `pull` and `push` verbs appear with all their subcommands listed. `--no-dependency` appears in root help.

- [ ] **Step 4: Commit**

```bash
git add dist/
git commit -m "build: compile final dependency-tree and verb-rename implementation"
```
