# ZDF — Claude Code Context

ZDF (Zuora Development Framework) is a TypeScript CLI that syncs Zuora billing objects
to local JSON files, edits them, and pushes changes back — with dependency-aware traversal.
See `README.md` for the full user-facing reference.

## Tech stack

- TypeScript, CJS output (`"type": "commonjs"`)
- Node16 module resolution — **all internal imports use `.js` extension** even for `.ts` source
- Commander.js with `getOrCreate(program, name, desc)` pattern for nested verb→resource subcommands
- Vitest — `vi.hoisted(() => vi.fn())` for all mock variables
- Build: `tsup bin/zdf.ts --format cjs --out-dir dist`

## Key helpers

| File | Purpose |
|------|---------|
| `src/helpers/dependency-graph.ts` | `resolveAndSync(resource, id, action, visited?)` — fetch + traverse |
| `src/helpers/updatable-fields.ts` | `filterUpdatableFields(resource, data)` — strip read-only/null before PUT |
| `src/helpers/file-io.ts` | `writeResourceFile`, `readResourceFile`, `renameResourceFile`, `deleteResourceFile` |
| `src/api/client.ts` | `apiGet`, `apiPost`, `apiPut`, `apiDelete`, `apiQuery` (ZOQL via `POST /v1/action/query`) |
| `src/auth/config.ts` | `getActiveEnv()` — reads `~/.zdf/config.json` |
| `src/helpers/command-runner.ts` | `runCommand(program, fn)` — wraps every action with error handling |
| `src/helpers/zuora-response.ts` | `assertSuccess(res, label)` — checks `res.success` on write responses |

## Critical API decisions

### Legacy object endpoints for product catalog

The Zuora v1 REST API does **not** support PUT for products, product rate plans, or
product rate plan charges. The legacy `/v1/object/` endpoints must be used for updates:

| Resource | pull | push / create / delete |
|----------|------|------------------------|
| product | `GET /v1/object/product/{id}` | push: `PUT /v1/object/product/{id}` · create: `POST /v1/catalog/products` · delete: `DELETE /v1/catalog/products/{id}` |
| product-rate-plan | `GET /v1/object/product-rate-plan/{id}` | push: `PUT /v1/object/product-rate-plan/{id}` · create: `POST /v1/object/product-rate-plan` · delete: `DELETE /v1/object/product-rate-plan/{id}` (Note: `/v1/rateplan` does not exist on intQA — live-verified 2026-08-07) |
| product-rate-plan-charge | `GET /v1/object/product-rate-plan-charge/{id}` | push: `PUT /v1/object/product-rate-plan-charge/{id}` · create: `POST /v1/object/product-rate-plan-charge` (requires `ProductRatePlanId`, `POBIdentifier__c`, `ProductRatePlanChargeTierData`) · delete: `DELETE /v1/object/product-rate-plan-charge/{id}` (also cascades from parent PRP delete) |

The object endpoints return **PascalCase** field names (`Name`, `ProductId`,
`EffectiveStartDate`). The `filterUpdatableFields` allowlists are written in PascalCase
to match. The push response uses `{ Success: boolean; Errors?: [...] }` (PascalCase),
not `{ success: boolean }`.

### ZOQL queries

Product catalog child lookups use ZOQL via `apiQuery<T>(zoql)`:
- Rate plans for a product: `SELECT Id FROM ProductRatePlan WHERE ProductId = '${id}'`
- Charges for a rate plan: `SELECT Id FROM ProductRatePlanCharge WHERE ProductRatePlanId = '${id}'`
- Contacts for account: `SELECT Id FROM Contact WHERE AccountId = '${id}'`
- Bill runs for account: `SELECT Id FROM BillRun WHERE AccountId = '${id}'`

### Invoice / credit-memo / debit-memo items

Sub-items are fetched and **embedded inline** in the pulled file for human reference
(`invoiceItems`, `creditMemoItems`, `debitMemoItems`). They are **stripped from push
bodies** — Zuora rejects them in a PUT request. `filterUpdatableFields` handles this
via the allowlist (items arrays are not in the allowlist).

### Async invoice delete

`DELETE /v1/invoices/{id}` returns a `jobId`. The CLI polls
`GET /v1/async-jobs/{jobId}` every 2 seconds (max 30 attempts) until
`jobStatus === 'Completed'`.

### order push body unwrapping

`GET /v1/orders/{orderNumber}` wraps the data under an `order` key in the response.
The push command unwraps it before filtering: `rawFull['order'] ?? rawFull`.

### bill-run push

Zuora has no PUT endpoint for bill runs. `push bill-run` re-fetches (same as pull)
rather than writing anything.

## Dependency graph rules (summary)

`resolveAndSync` uses a visited-set (`Set<string>`) to prevent loops. Key traversal rules:

- **account pull** → contacts (ZOQL), orders, subscriptions, invoices, credit-memos, debit-memos, bill-runs
- **account** (always) → parent account if `parentId` set
- **order** (always) → parent account (via `GET /v1/accounts/{accountNumber}` → `basicInfo.id`), order line items, subscriptions
- **product** (always) → product-rate-plans (ZOQL)
- **product-rate-plan** (always) → parent product; pull also → charges (ZOQL)
- **product-rate-plan-charge** (always) → parent product-rate-plan
- **invoice/credit-memo/debit-memo** push/delete → parent account
- **bill-run** (always) → parent account, invoices (ZOQL), credit-memos, debit-memos (ZOQL)

Use `--no-dependency` to skip all traversal. Essential for large accounts with hundreds
of child records.

## updatable-fields allowlist notes

- `contact`: strips `id`, `accountId`, `accountNumber` (read-only)
- `subscription`: only header-level fields; rate plan changes require the Orders API
- `order`: only `category`, `description`, `orderDate`, `reasonCode`; push only works on Draft/Scheduled orders
- `product` / `product-rate-plan` / `product-rate-plan-charge`: PascalCase keys; `ChargeType` and `ChargeModel` are NOT updatable on charges
- Billing objects (invoice/credit-memo/debit-memo): header fields only; no items arrays
- Custom fields (`__c` suffix) always pass through regardless of allowlist
- Resources with no allowlist entry (`workflow`, `billing-template`) pass through unfiltered

## Test conventions

```typescript
// All mock variables must use vi.hoisted
const mockGet = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, /* ... */, setDebug: vi.fn() }));

// process.exit testing pattern
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
await expect(makeProgram().parseAsync([...])).rejects.toThrow('exit');
exitSpy.mockRestore();
```

## Resource coverage

| Resource | pull | push | create | delete | list |
|----------|------|------|--------|--------|------|
| account | ✓ | ✓ | ✓ | ✓ | |
| contact | ✓ | ✓ | ✓ (direct object response, no envelope) | ✓ | |
| subscription | ✓ | ✓ | blocked (order-enabled tenant) | blocked | |
| order | ✓ | ✓ | ✓ | ✓ | ✓ |
| order-line-item | ✓ | ✓ | | | |
| product | ✓ | ✓ | blocked (405 on intQA) | ✓ | |
| product-rate-plan | ✓ | ✓ | ✓ (`/v1/object/product-rate-plan`) | ✓ | |
| product-rate-plan-charge | ✓ | ✓ | ✓ | ✓ (cascade via parent PRP) | |
| invoice | ✓ | ✓ | blocked-by-tenant-config | ✓ async | |
| credit-memo | ✓ | ✓ | untested (tenant-gated) | ✓ | |
| debit-memo | ✓ | ✓ | untested (tenant-gated) | ✓ | |
| bill-run | ✓ | re-fetch | ✓ (executes real billing) | ✓ (Pending/Canceled only) | |
| workflow | ✓ | ✓ | ✓ | ✓ | |
| billing-template | ✓ (HTML-only) | ✓ | ✓ | ✓ | ✓ |

See `zdf/TODO.md` "Push side cycle test results (2026-08-07)" for the live-verification detail
behind the create/delete column above, and "Known tenant-config limitations" for the blocked/
untested entries.
