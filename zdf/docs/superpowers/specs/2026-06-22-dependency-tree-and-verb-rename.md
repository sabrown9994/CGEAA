# ZDF — Dependency Tree, Verb Rename, and New Resources
Design Spec | 2026-06-22

## Overview

Two related changes to `zdf`:

1. **Verb rename**: `get` → `pull`, `update` → `push` across all commands
2. **Dependency tree**: every API action automatically re-fetches all logically related objects into the local store, keeping `zdf-output/` always accurate. Traversal uses a visited set to prevent circular loops. Enabled by default; skipped with `--no-dependency`.

Four new resources are added: `invoice`, `credit-memo`, `debit-memo`, `bill-run`.

---

## Motivation

- `pull`/`push` describe data flow direction more accurately than `get`/`update`
- Without dependency traversal, the local store drifts — e.g. pulling an order doesn't update the account that owns it, leaving the developer with stale data
- A visited-set traversal engine centralises all relationship rules in one place rather than duplicating logic per command

---

## Verb Rename

All existing commands rename:

| Old verb | New verb |
|---|---|
| `zdf get <resource> <id>` | `zdf pull <resource> <id>` |
| `zdf update <resource> <id>` | `zdf push <resource> <id>` |
| `zdf create <resource> <name>` | unchanged |
| `zdf delete <resource> <id>` | unchanged |
| `zdf list <resource>` | unchanged |

Affected command files: `accounts.ts`, `contacts.ts`, `subscriptions.ts`, `products.ts`, `product-rate-plans.ts`, `product-rate-plan-charges.ts`, `workflows.ts`, `billing-templates.ts`, `data-queries.ts`, `orders.ts`

---

## New Resources

Four new command files:

| Resource | Commands | Zuora endpoints |
|---|---|---|
| `invoice` | pull, push, delete | `GET/PUT/DELETE /v1/invoices/{invoiceKey}` |
| `credit-memo` | pull, push, delete | `GET/PUT/DELETE /v1/credit-memos/{creditMemoKey}` |
| `debit-memo` | pull, push, delete | `GET/PUT/DELETE /v1/debit-memos/{debitMemoKey}` |
| `bill-run` | pull, push (re-fetch only), delete | `GET/DELETE /v1/bill-runs/{billRunId}` |

New `RESOURCE_SUBFOLDERS` entries:

```typescript
'invoice': 'invoices',
'credit-memo': 'credit-memos',
'debit-memo': 'debit-memos',
'bill-run': 'bill-runs',
```

### Delete constraints

- `invoice`: synchronous for <100 items; async (returns `jobId`) for ≥100 items — poll `GET /v1/async-jobs/{jobId}` until complete
- `credit-memo`: only `Draft` status
- `debit-memo`: only `Canceled` status
- `bill-run`: only `Canceled` or `Error` status
- `bill-run` push: no PUT endpoint exists — push re-fetches the bill run and overwrites the local file (equivalent to pull)

---

## File Shapes

### Invoice (`zdf-output/invoices/<id>.json`)

```json
{
  "id": "INV-001",
  "accountId": "ACC-001",
  "billRunId": "BR-001",
  "status": "Posted",
  "amount": 500.00,
  "invoiceItems": [
    {
      "id": "item-1",
      "subscriptionId": "SUB-001",
      "amount": 500.00,
      "taxationItems": {
        "data": [{ "id": "tax-1", "taxAmount": 50.00 }]
      }
    }
  ]
}
```

Items fetched via `GET /v1/invoices/{id}/items` (paginated). Taxation items are inline within each item's `taxationItems.data[]` array.

### Credit Memo (`zdf-output/credit-memos/<id>.json`)

```json
{
  "id": "CM-001",
  "accountId": "ACC-001",
  "referredInvoiceId": "INV-001",
  "sourceId": "BR-00007954",
  "status": "Posted",
  "amount": 100.00,
  "creditMemoItems": [
    {
      "id": "item-1",
      "taxationItems": {
        "data": [{ "id": "tax-1", "taxAmount": 10.00 }]
      }
    }
  ]
}
```

Items fetched via `GET /v1/credit-memos/{id}/items` (paginated).

### Debit Memo (`zdf-output/debit-memos/<id>.json`)

Same embedded pattern as credit memo, with `debitMemoItems` array. Items fetched via `GET /v1/debit-memos/{id}/items`.

### Bill Run (`zdf-output/bill-runs/<id>.json`)

Top-level record only — no embedded children.

```json
{
  "id": "BR-001",
  "billRunNumber": "BR-00007954",
  "status": "Completed",
  "targetDate": "2026-01-31"
}
```

### Subscription (`zdf-output/subscriptions/<id>.json`) — updated shape

Subscription-level rate plans and rate plan charges are embedded inline (returned by Zuora in the subscription response). No separate files or commands for these objects.

```json
{
  "id": "SUB-001",
  "subscriptionNumber": "A-S00000001",
  "accountId": "ACC-001",
  "orderNumber": "O-00000001",
  "status": "Active",
  "ratePlans": [
    {
      "id": "rp-001",
      "productRatePlanId": "prp-001",
      "productName": "Basic Plan",
      "ratePlanCharges": [
        { "id": "rpc-001", "name": "Monthly Fee", "price": 99.00 }
      ]
    }
  ]
}
```

### All other resources

Unchanged from current shape.

### File update behavior

Every write operation (pull, push, or dependency re-fetch) deletes the existing local file and writes a new one with the latest data. No in-place field patching.

---

## Dependency Graph Module

New file: `src/helpers/dependency-graph.ts`

### Core function

```typescript
async function resolveAndSync(
  resource: string,
  id: string,
  action: 'pull' | 'push' | 'delete',
  visited: Set<string> = new Set()
): Promise<void>
```

The visited set key is `"resource:id"` (e.g. `"account:ACC-001"`). Before fetching any object the engine checks the visited set — if already present, skip. Add immediately before fetching. This prevents circular loops (e.g. pull order → re-fetch account → would re-fetch orders → already visited → stop).

### Rule registry structure

```typescript
interface DependencyRule {
  parents?: ParentRule[];   // objects to re-fetch upward
  children?: ChildRule[];   // objects to fetch downward
}

const DEPENDENCY_RULES: Record<string, Record<'pull' | 'push' | 'delete', DependencyRule>>
```

### Progress output

Emitted by the dependency graph engine (not command files) via `output.info()`:

```
✔ Order O-00000001 written to zdf-output/orders/O-00000001.json
ℹ Resolving dependencies for order O-00000001...
ℹ Fetching parent account ACC-001...
  ✔ Account ACC-001 written
ℹ Fetching 3 order line items...
  ✔ Order line item li-uuid-1 written
  ✔ Order line item li-uuid-2 written
  ✔ Order line item li-uuid-3 written
ℹ Fetching 2 subscriptions...
  ✔ Subscription A-S00000001 written
  ✔ Subscription A-S00000002 written
```

### Delete behavior for children

When action is `delete`, after the Zuora DELETE call succeeds, the engine attempts to re-fetch each child. If the re-fetch returns a 404, the local `.json` file is deleted. If the re-fetch succeeds (object still exists in Zuora), the local file is overwritten with the latest data.

---

## Complete Dependency Rule Table

| Resource | Action | Upstream (re-fetch) | Downstream (fetch) | API mechanism |
|---|---|---|---|---|
| account | pull | parent account (if `parentId` exists) | contacts, orders, subscriptions, invoices, credit-memos, debit-memos, bill-runs | ZOQL for contacts + bill-runs; REST for rest |
| account | push | parent account (if `parentId` exists) | — | REST |
| account | delete | — | attempt re-fetch all children above; delete local on 404 | REST + ZOQL |
| contact | pull | — | — | — |
| contact | push | parent account | — | REST |
| contact | delete | parent account | — | REST |
| order | pull | parent account | order-line-items (inline), subscriptions (inline summary → fetch each full record) | REST |
| order | push | parent account | order-line-items, subscriptions | REST |
| order | delete | parent account | attempt re-fetch order-line-items + subscriptions; delete local on 404 | REST |
| order-line-item | pull | — | — | — |
| order-line-item | push | parent order → cascades to account | — | REST |
| order-line-item | delete | parent order → cascades to account | — | REST |
| subscription | pull | — | rate-plans + rate-plan-charges (inline in subscription response, embedded in file) | REST |
| subscription | push | parent account, parent order (if `orderNumber` exists) | rate-plans + rate-plan-charges | REST |
| subscription | delete | parent account, parent order (if linked) | attempt re-fetch; delete local on 404 | REST |
| product | pull | — | product-rate-plans → product-rate-plan-charges (inline in rate plan response) | REST |
| product | push | — | product-rate-plans → product-rate-plan-charges | REST |
| product | delete | — | attempt re-fetch all below; delete local on 404 | REST |
| product-rate-plan | pull | parent product | product-rate-plan-charges (inline) | REST |
| product-rate-plan | push | parent product | product-rate-plan-charges | REST |
| product-rate-plan | delete | parent product | attempt re-fetch charges; delete local on 404 | REST |
| product-rate-plan-charge | pull | parent product-rate-plan → parent product | — | REST |
| product-rate-plan-charge | push | parent product-rate-plan → parent product | — | REST |
| product-rate-plan-charge | delete | parent product-rate-plan → parent product | — | REST |
| invoice | pull | — | invoice-items + taxation-items (embedded); bill-run (if `billRunId` exists) | REST |
| invoice | push | parent account | invoice-items + taxation-items; bill-run (if exists) | REST |
| invoice | delete | parent account | attempt re-fetch bill-run; delete local on 404 | REST |
| credit-memo | pull | — | credit-memo-items + taxation-items (embedded); bill-run (if `sourceId` links to one) | REST |
| credit-memo | push | parent account | credit-memo-items + taxation-items; bill-run (if exists) | REST |
| credit-memo | delete | parent account | attempt re-fetch bill-run; delete local on 404 | REST |
| debit-memo | pull | — | debit-memo-items + taxation-items (embedded) | REST |
| debit-memo | push | parent account | debit-memo-items + taxation-items | REST |
| debit-memo | delete | parent account | — | REST |
| bill-run | pull | parent account | invoices (ZOQL), credit-memos (`sourceId` filter), debit-memos (ZOQL) → each with embedded items | REST + ZOQL |
| bill-run | push | parent account | same as pull (re-fetch all) | REST + ZOQL |
| bill-run | delete | parent account | attempt re-fetch invoices, credit-memos, debit-memos; delete local on 404 | REST + ZOQL |

---

## API Client Changes

New method added to `src/api/client.ts`:

```typescript
export async function apiQuery<T>(zoql: string): Promise<T[]>
```

Implementation: `POST /v1/action/query` with body `{ queryString: zoql }`. Synchronous — no polling needed. Used for:

- Contacts by account: `SELECT Id FROM Contact WHERE AccountId = '{accountId}'`
- Bill runs by account: `SELECT Id FROM BillRun WHERE AccountId = '{accountId}'`
- Invoices by bill run: `SELECT Id FROM Invoice WHERE BillRunId = '{billRunId}'`
- Debit memos by bill run: `SELECT Id FROM DebitMemo WHERE BillRunId = '{billRunId}'` (if supported)

---

## `--no-dependency` Flag

Added to the root program (alongside `--debug`):

```typescript
program.option('--no-dependency', 'skip dependency tree traversal')
```

When set, `resolveAndSync` is not called after any action. The command executes only the primary API call and writes only the primary object's file.

---

## Push Request Body Behavior

- All push operations send the full local file contents through `filterUpdatableFields` before PUT
- `filterUpdatableFields` entries will be added for `invoice`, `credit-memo`, `debit-memo` covering their top-level updatable fields plus their embedded items arrays (`invoiceItems`, `creditMemoItems`, `debitMemoItems`)
- Read-only fields (`status`, `amount` computed totals, `createdDate`, audit fields) are stripped
- Null values are stripped (existing behavior)

---

## Updated Output Folder Structure

```
./zdf-output/
├── accounts/
├── contacts/
├── subscriptions/         ← now embeds ratePlans[] + ratePlanCharges[]
├── products/
├── product-rate-plans/
├── product-rate-plan-charges/
├── workflows/
├── billing-templates/
├── data-queries/
├── orders/
├── order-line-items/
├── invoices/              ← new; embeds invoiceItems[] + taxationItems[]
├── credit-memos/          ← new; embeds creditMemoItems[] + taxationItems[]
├── debit-memos/           ← new; embeds debitMemoItems[] + taxationItems[]
└── bill-runs/             ← new
```

---

## Error Handling

- All new commands use `assertSuccess(res, label)` for write operations
- Async invoice delete: after DELETE returns `jobId`, poll `GET /v1/async-jobs/{jobId}` until `jobStatus === 'Completed'` before proceeding with dependency traversal
- ZOQL errors surface via the existing `ZuoraErrorResponse` error structure
- If a dependency re-fetch 404s during a delete cascade, delete the local file and continue (do not abort the chain)
- If a dependency re-fetch fails with a non-404 error, log a warning and continue (do not abort the chain)

---

## Testing

Each new command file gets a test file under `src/__tests__/commands/`. The dependency graph module gets its own test file at `src/__tests__/helpers/dependency-graph.test.ts`. Tests mock `resolveAndSync` in command tests to isolate command logic from traversal logic. The dependency graph tests verify the visited-set loop prevention and correct rule lookup per resource/action combination.
