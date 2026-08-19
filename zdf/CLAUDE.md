# ZDF — Claude Code Context

ZDF (Zuora Development Framework) is a TypeScript CLI that syncs Zuora billing objects
to local JSON files, edits them, and pushes changes back — with dependency-aware traversal.
See `README.md` for the full user-facing reference and `TODO.md` for known limitations and
open work items.

## Tech stack

- TypeScript, CJS output (`"type": "commonjs"`)
- Node16 module resolution — **all internal imports use `.js` extension** even for `.ts` source
- Commander.js with `getOrCreate(program, name, desc)` pattern for nested verb→resource subcommands
- Vitest — `vi.hoisted(() => vi.fn())` for all mock variables
- Build: `tsup bin/zdf.ts --format cjs --out-dir dist`
- Entry point: `bin/zdf.ts` → compiled to `dist/zdf.js`

## Key helpers

| File | Purpose |
|------|---------|
| `src/helpers/dependency-graph.ts` | `resolveAndSync(resource, id, action, visited?)` — fetch + traverse; returns `boolean` (true = top-level resource was fetched). Also exports cap constants and setters. |
| `src/helpers/updatable-fields.ts` | `filterUpdatableFields(resource, data)` — strip read-only fields before PUT |
| `src/helpers/file-io.ts` | `writeResourceFile`, `readResourceFile`, `renameResourceFile`, `deleteResourceFile`, `resolveFilePath`, `getOutputDir` |
| `src/api/client.ts` | `apiGet`, `apiPost`, `apiPut`, `apiDelete`, `apiQuery` (ZOQL via `POST /v1/action/query`); cap constants `APIQUERY_MAX_ROWS` |
| `src/auth/config.ts` | `getActiveEnv()` — reads `~/.zdf/config.json` or CI env vars (see below) |
| `src/auth/token.ts` | `ensureToken(env, force?)` — fetches/caches OAuth token; `force=true` bypasses expiry |
| `src/helpers/command-runner.ts` | `runCommand(program, fn)` — wraps every action; thrown `Error` → `output.error` + `process.exit(1)` |
| `src/helpers/zuora-response.ts` | `assertSuccess(res, label)` — checks `res.success` (lowercase envelope); `assertReadSuccess(res, label)` — checks for absence of `success:false` / `reasons`/`errors` (used for responses with no `success` field, e.g. Workflows API, Settings API) |
| `src/helpers/delete-guard.ts` | `checkDeleteAllowed(resource)` — throws on Zuora-API-blocked deletes; `checkTenantSupported(resource, verb)` — throws on tenant-config-blocked creates |
| `src/helpers/progress.ts` | `ora`-based progress spinner, inert when stdout is not a TTY |

## Pagination / traversal caps

Three named, exported constants that can be overridden at runtime via CLI flags
(`--max-rows`, `--max-nodes`, `--max-items`) or the `--no-caps`/`--unbounded` flag:

| Constant | Default | Location | Bounds |
|---|---|---|---|
| `APIQUERY_MAX_ROWS` | 5000 | `src/api/client.ts` | ZOQL `queryMore` pagination |
| `MAX_TRAVERSAL_NODES` | 500 | `src/helpers/dependency-graph.ts` | `resolveAndSync` dependency walk |
| `FETCH_ALL_ITEMS_MAX` | 5000 | `src/helpers/dependency-graph.ts` | `fetchAllItems` pagination |

Each cap emits `output.warn` (never throws) when hit. Passing `--no-caps` sets all three
to `Infinity` with a single warning printed.

## Critical API decisions

### Legacy object endpoints for product catalog

The Zuora v1 REST API does **not** support PUT for products, product rate plans, or
product rate plan charges. The legacy `/v1/object/` endpoints must be used for all writes:

| Resource | pull | push / create / delete |
|----------|------|------------------------|
| product | `GET /v1/object/product/{id}` | push: `PUT /v1/object/product/{id}` · create: `POST /commerce/products` (Commerce API — see below) · delete: `DELETE /v1/object/product/{id}` |
| product-rate-plan | `GET /v1/object/product-rate-plan/{id}` | push: `PUT /v1/object/product-rate-plan/{id}` · create: `POST /v1/object/product-rate-plan` · delete: `DELETE /v1/object/product-rate-plan/{id}` |
| product-rate-plan-charge | `GET /v1/object/product-rate-plan-charge/{id}` | push: `PUT /v1/object/product-rate-plan-charge/{id}` · create: `POST /v1/object/product-rate-plan-charge` · delete: `DELETE /v1/object/product-rate-plan-charge/{id}` |

The object endpoints return **PascalCase** field names (`Name`, `ProductId`,
`EffectiveStartDate`). The `filterUpdatableFields` allowlists are written in PascalCase.
The push response uses `{ Success: boolean; Errors?: [...] }` (PascalCase) — handled
inline in each command (not via `assertSuccess` which checks lowercase `success`).
The delete response returns lowercase `{ success, id }` — handled via `assertSuccess`.

### Product create — Commerce API (not the legacy catalog endpoint)

The legacy `POST /v1/catalog/products` is **disabled (405)** on the intQA tenant. `create product`
instead uses the modern **Commerce API** `POST /commerce/products`, which creates the product, its
plan, and its charge in a single call:
- **Body is snake_case** (`start_date`, `charge_model`, `end_date_condition`, `bill_cycle`, …) — a
  distinct schema from the legacy PascalCase object model. It is posted **verbatim** from the local
  file; `filterUpdatableFields` is NOT applied.
- **Response is the product object directly** — HTTP 200 with `{ id, state, plans: [{ id,
  productRatePlanCharges: [{ id }] }] }` and **no `success` field**. Guarded with
  `assertReadSuccess` (like `contact` create), then read the lowercase `res.id`.
- **Tenant requires** (live-verified 2026-08-14): `pricing` as an object keyed by currency
  (`{ "flatAmounts": { "USD": 10 } }`, not an array); a full `accounting` block with all 8 finance
  accounts non-blank (`accounting_code`, `deferred_revenue_account`, `recognized_revenue_account`,
  `unbilled_receivables_account`, `contract_asset_account`, `contract_liability_account`,
  `contract_recognized_revenue_account`, `adjustment_liability_account`, `adjustment_revenue_account`);
  and required custom fields (product: `item__c`, `productfamily__c`; charge: `pobidentifier__c`,
  `pobname__c`). The caller supplies these in the local JSON file. Valid accounting-code names and
  custom-field values are tenant-specific (query `/v1/accounting-codes` and existing products).
- **Delete** uses the legacy `DELETE /v1/object/product/{id}` (live-verified to remove a
  Commerce-created product) — the Commerce API has no delete endpoint.

### Response envelope patterns

Not all Zuora endpoints return `{ success: boolean }`:

| Pattern | When used | Guard |
|---|---|---|
| `{ success: true/false, reasons?: [...] }` | Most v1 write endpoints | `assertSuccess` |
| `{ Success: true/false, Errors?: [...] }` (PascalCase) | Legacy `/v1/object/` creates and pushes | Inline check in each command |
| Direct resource object (no `success` field) | Workflows API (PUT/DELETE), contact create (`POST /v1/contacts`), Settings API (billing-template PUT/DELETE) | `assertReadSuccess` |
| `{ id, success }` lowercase | Product-rate-plan-charge delete via `/v1/object/` | `assertSuccess` |

Using the wrong guard causes silent failures. When adding a new command, check what the
endpoint actually returns before choosing a guard.

### Tenant-config guards

`src/helpers/delete-guard.ts` exports two guard functions — `checkTenantSupported(resource, verb)`
and `checkDeleteAllowed(resource)`. **Both maps are currently empty** (no resource is blocked): the
formerly-blocked creates were all resolved — `create product` via the Commerce API and
`create invoice` by passing accounting fields in the body — and `create subscription` /
`delete subscription` were removed entirely (see below). The functions and their (empty) maps are
retained so future tenant-blocked resources can be added in one place.

### Subscription: no create / no delete (removed)

`subscription` supports **pull and push only**. `create subscription` and `delete subscription`
were removed as permanently unsupported: Orders-enabled tenants disable the legacy
Subscriptions-API create (`53000010`), and Zuora exposes no DELETE endpoint for subscriptions at
all. Manage subscription lifecycle via the Orders API (`create order`) / the Zuora UI.

### ZOQL queries

Product catalog child lookups use ZOQL via `apiQuery<T>(zoql)`:
- Rate plans for a product: `SELECT Id FROM ProductRatePlan WHERE ProductId = '${id}'`
- Charges for a rate plan: `SELECT Id FROM ProductRatePlanCharge WHERE ProductRatePlanId = '${id}'`
- Contacts for account: `SELECT Id FROM Contact WHERE AccountId = '${id}'`
- Bill runs for account: `SELECT Id FROM BillRun WHERE AccountId = '${id}'`

`apiQuery` does NOT honor ZOQL `LIMIT` clauses — `/v1/action/query` paginates all matching
rows regardless. Use `APIQUERY_MAX_ROWS` / `--max-rows` to bound pagination.

### Invoice / credit-memo / debit-memo items

Sub-items are fetched and **embedded inline** in the pulled file for human reference
(`invoiceItems`, `creditMemoItems`, `debitMemoItems`). They are **stripped from push
bodies** — Zuora rejects them in a PUT request. `filterUpdatableFields` handles this
via the allowlist (items arrays are not in the allowlist).

**Item fetch key difference (live-verified):** `/v1/invoices/{id}/items` returns the array
under `invoiceItems`; `/v1/credit-memos/{id}/items` and `/v1/debit-memos/{id}/items` return
theirs under `items`. The `fetchAllItems` call in `dependency-graph.ts` uses different
`itemsKey` values accordingly.

### Credit-memo / debit-memo creates

The CLI uses the **invoice-scoped** endpoint (`POST /v1/credit-memos/invoice/{invoiceKey}`,
`POST /v1/debit-memos/invoice/{invoiceKey}`) rather than the bare `POST /v1/credit-memos`.
The bare endpoint is unreliable on this tenant. `--invoice <invoiceId>` is required (throws before
any network call if omitted) and must point at a **Posted** invoice (a Draft source is rejected:
"Invoice is not posted"). The file is posted verbatim and must be
`{ "items": [ { "invoiceItemId, amount, skuName } ] }` — **each item requires `invoiceItemId`,
`amount`, and a non-blank `skuName`** ("SKU name is blank" otherwise). Get `invoiceItemId` from
`GET /v1/invoices/{id}/items`. **Create is live-verified** (Draft memo with items). **Known gap:**
`delete credit-memo`/`delete debit-memo` on an invoice-sourced Draft memo is rejected live (the memo
is applied to its invoice; deletion likely needs a cancel/unapply step first — not yet implemented;
see TODO.md).

### Invoice create / delete

**Create** (`create invoice`): `POST /v1/invoices` with a **flat single-invoice object**
(`{ accountNumber, invoiceDate, invoiceItems: [...] }` — NOT an `invoices: [...]` wrapper). The
success response is a flat invoice object that includes `success: true` AND `id` → guarded with
`assertSuccess`, then read `res.id`. The body is posted **verbatim** from the local file. The
tenant does not default the accounting settings, so **each invoice item must carry** (live-verified):
`amount` (the amount field is `amount`, not `chargeAmount`/`unitPrice`); date fields in
`yyyy-MM-dd HH:mm:ss` format; a `revenueRecognitionRuleName` (e.g. `"Recognize upon invoicing"`);
and 8 accounting codes (`deferredRevenueAccountingCode`, `recognizedRevenueAccountingCode`,
`unbilledReceivablesAccountingCode`, `contractAssetAccountingCode`, `contractLiabilityAccountingCode`,
`contractRecognizedRevenueAccountingCode`, `adjustmentLiabilityAccountingCode`,
`adjustmentRevenueAccountingCode`). This is the caller's responsibility in the JSON file — the CLI
injects nothing EXCEPT: the `--post` flag injects `status: "Posted"` into the body so the invoice is
created Posted. Default (no flag) creates a **Draft** invoice. `--post` prints a warning because a
Posted invoice is not deletable (see below). Posting only works at create time — there is no working
endpoint to post an already-existing Draft invoice on this tenant (`PUT status`/`invoiceStatus`
rejected, `/post` 405).

**Invoice lifecycle on this tenant (live-verified — note it's inverted from intuition):**
- `PUT /v1/invoices/{id}/cancel` succeeds ONLY on **Draft** (Draft → Cancelled); it FAILS on Posted
  ("Only invoices with Draft status can be cancelled").
- `DELETE /v1/invoices/{id}` succeeds ONLY on Cancelled/Split.
- Net: **Draft invoices are deletable** (cancel → delete); **Posted invoices are NOT deletable at
  all** (reverse them with a credit memo).

**Delete** (`delete invoice`): first `GET /v1/invoices/{id}` to check status. If not-found
(`success:false`) → throw not-found. If `status === 'Posted'` → throw a clear "cannot delete Posted;
reverse via credit memo" error (no cancel/delete attempted). Otherwise (Draft/Cancelled): (1)
`PUT /v1/invoices/{id}/cancel` — on `success:false` warn and continue (an already-cancelled invoice
still deletes); (2) `DELETE /v1/invoices/{id}`. The DELETE returns a `jobId`, but that job is **NOT**
queryable at `/v1/async-jobs/{jobId}` (live-confirmed: always `success:false` "Cannot find response
for job"). Completion is confirmed by **polling the invoice resource for disappearance** —
`GET /v1/invoices/{id}` every 2s (max 30) until it returns `success:false`. Do NOT reintroduce
async-jobs polling for invoices.

### order push body unwrapping

`GET /v1/orders/{orderNumber}` wraps the data under an `order` key in the response.
The push command unwraps it before filtering: `rawFull['order'] ?? rawFull`. `push order`
only works on orders in Draft or Scheduled status — Completed orders are rejected by Zuora.

### bill-run push

Zuora has no PUT endpoint for bill runs. `push bill-run` re-fetches (same as pull)
rather than writing anything. `delete bill-run` only works on Canceled or Error status.

### Workflows API

The endpoint is `/workflows` (not `/v1/api/workflows`). Workflow PUT and DELETE return the
resource object directly with no `{success}` envelope — use `assertReadSuccess`.

### Settings API (billing-template)

`/settings/invoice-templates` (NOT `/v1/`-prefixed). Responses have no `{success}` envelope.
HTML templates only — `pull billing-template` base64-decodes `base64EncodedTemplateFileContent`
to the design JSON and writes it as `<sanitizedName>_<id>.json`. The push allowlist is
explicit because the Settings API rejects any unexpected key.

### orders list — account filtering

`list orders --account <key>` uses `GET /v1/orders/subscriptionOwner/{accountKey}`. The
generic `GET /v1/orders?accountId=...` filter is ignored server-side by this tenant.
The account→orders traversal in `dependency-graph.ts rulesAccount` uses the same endpoint.

### orders account key vs. internal id

`resolveAndSync('order', orderNumber, action)` uses the order NUMBER as the identifier
(e.g. `O-01339581`), not an internal UUID. This is different from most resources which use
internal UUIDs.

## Dependency graph rules (summary)

`resolveAndSync` uses a visited-set (`Set<string>`) to prevent loops and returns `true` if
the TOP-LEVEL requested resource was fetched, `false` otherwise. Only the top-level call's
result drives the command's exit code — child traversal failures warn and continue (so a
partial failure in a bill-run's invoice children does not abort the parent pull).

Key traversal rules:
- **account pull** → contacts (ZOQL), orders (subscriptionOwner), subscriptions, invoices, credit-memos, debit-memos, bill-runs
- **account** (always) → parent account if `parentId` set
- **order** (always) → parent account (via `GET /v1/accounts/{accountNumber}` → `basicInfo.id`), order line items, subscriptions
- **product** (always) → product-rate-plans (ZOQL)
- **product-rate-plan** (always) → parent product; pull also → charges (ZOQL)
- **product-rate-plan-charge** (always) → parent product-rate-plan
- **invoice/credit-memo/debit-memo** push/delete → parent account
- **bill-run** (always) → parent account, invoices (ZOQL), credit-memos, debit-memos (ZOQL)

Use `--no-dependency` to skip all traversal. Essential for large accounts.

## Updatable-fields allowlist notes

- `contact`: strips `id`, `accountId`, `accountNumber` (read-only)
- `subscription`: only header-level fields; rate plan changes require the Orders API
- `order`: only `category`, `description`, `orderDate`, `reasonCode`; Draft/Scheduled only
- `product` / `product-rate-plan` / `product-rate-plan-charge`: PascalCase keys; `ChargeType` and `ChargeModel` are NOT updatable on charges
- `invoice`: header fields only (`autoPay`, `comments`, `dueDate`, `invoiceDate`, `paymentTerm`, `transferredToAccounting`); no items arrays
- `credit-memo`: `comment`, `excludeFromAutoApplyRules`, `reasonCode`, `transferredToAccounting` only — `creditMemoDate` and `autoApplyUponPosting` are rejected by Zuora PUT on Posted memos (live-verified; removed from allowlist)
- `debit-memo`: `autoPay`, `comment`, `paymentTerm`, `reasonCode`, `transferredToAccounting` only — `debitMemoDate` and `dueDate` are rejected by Zuora PUT on Posted memos (live-verified; removed from allowlist)
- Custom fields (`__c` suffix) always pass through regardless of allowlist
- Resources with no allowlist entry (`workflow`, `billing-template`) pass through unfiltered

## Resource coverage

| Resource | pull | push | create | delete | list |
|----------|------|------|--------|--------|------|
| account | ✓ | ✓ | ✓ | ✓ | |
| contact | ✓ | ✓ | ✓ (direct object response, no envelope; uses `assertReadSuccess`) | ✓ | |
| subscription | ✓ | ✓ | — (removed; use Orders API) | — (removed; no Zuora DELETE endpoint) | |
| order | ✓ | ✓ (Draft/Scheduled only) | ✓ | ✓ | ✓ |
| order-line-item | ✓ | ✓ | | | |
| product | ✓ | ✓ | ✓ (Commerce API `POST /commerce/products`) | ✓ (`DELETE /v1/object/product/{id}`) | |
| product-rate-plan | ✓ | ✓ | ✓ (`POST /v1/object/product-rate-plan`) | ✓ | |
| product-rate-plan-charge | ✓ | ✓ | ✓ (requires `POBIdentifier__c` + `ProductRatePlanChargeTierData`) | ✓ | |
| invoice | ✓ | ✓ | ✓ (`POST /v1/invoices`; accounting fields required in body) | ✓ (cancel-then-delete; disappearance poll) | |
| credit-memo | ✓ | ✓ | ✓ (`--invoice <id>` required; `skuName` per item) | ✓ (Draft only) | |
| debit-memo | ✓ | ✓ | ✓ (`--invoice <id>` required; `skuName` per item) | ✓ (Canceled only) | |
| bill-run | ✓ | re-fetch (no PUT) | ✓ (⚠ executes real billing) | ✓ (Canceled/Error only) | |
| workflow | ✓ | ✓ | ✓ | ✓ | |
| billing-template | ✓ (HTML only) | ✓ | ✓ | ✓ | ✓ |
| data-query | ✓ | | ✓ (submits job) | ✓ (cancels job) | |

See `TODO.md` "Tenant-config limitations" for details on the ✗ blocked entries and what
would need to change to enable them.

## Scope & promotion — why ZDF is NOT a CI/CD pipeline

ZDF is a **developer CLI for interacting with multiple Zuora tenants**, not a promotion
pipeline. It has exactly three in-scope use cases:

1. **Config editing** — pull/push `workflow` and `billing-template` between Zuora and the IDE,
   so they can be edited with Claude Code or other AI tooling.
2. **Test data** — pull/push financial/test data (account, contact, subscription, order,
   product catalog, invoice, memos, bill-run) into **lower** environments for accurate QA and
   bug reproduction.
3. **Targeted automation** — scripted one-off tasks such as creating products (and their rate
   plans / charges) in production from a ticket.

**Promotion between environments (IntQA → StagingUAT → Production) is handled by Zuora's native
Deployment Manager, outside ZDF** — not by ZDF. See `docs/promotion-deployment-manager.md` for
the design rationale and the key constraint that drove this split.

The short version: an earlier design had ZDF host a `git diff → per-object create/push/delete`
CI/CD pipeline (the removed `sync-diff` feature). We dropped it because Zuora's Deployment
Manager API deploys config at the **component-type** level (whole `workflows`, whole
`productCatalog`, etc.) with **no object-level selection** — so a "promote just this feature's
objects" pipeline cannot be built on that API, and per-tenant internal ids aren't stable
cross-environment identifiers anyway. Deployment Manager already does its own tenant-to-tenant
matching, so promotion is its job, and ZDF stays a surgical, object-level developer tool.

> **Historical note:** the `sync-diff` command (`src/{helpers,commands}/sync-diff.ts` + tests)
> was implemented and then **removed** on 2026-08-19 when promotion moved to Deployment Manager.
> If you find lingering references to it, delete them.

## Test conventions

```typescript
// All mock variables must use vi.hoisted
const mockGet = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({
  apiGet: mockGet, apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
  apiQuery: vi.fn(), setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000,
}));

// dependency-graph mock (include all exports commands use)
const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(), isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(), setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500, FETCH_ALL_ITEMS_MAX: 5000,
}));

// process.exit testing pattern
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
await expect(makeProgram().parseAsync([...])).rejects.toThrow('exit');
exitSpy.mockRestore();

// resolveAndSync returns boolean — mock true for success, false to simulate top-level fetch failure
mockResolve.mockResolvedValue(true);   // resource was fetched
mockResolve.mockResolvedValue(false);  // resource was NOT fetched → command throws
```

## CI/CD and automation

ZDF is designed for use in GitHub Actions pipelines that sync Zuora configuration
to/from a git repository as part of a deployment workflow.

### Authentication — environment variables (preferred in CI)

Set three environment variables to bypass `~/.zdf/config.json` entirely:

```yaml
env:
  ZDF_CLIENT_ID: ${{ secrets.ZUORA_CLIENT_ID }}
  ZDF_CLIENT_SECRET: ${{ secrets.ZUORA_CLIENT_SECRET }}
  ZDF_BASE_URL: https://rest.zuora.com   # or your tenant-specific URL
  # Optional:
  ZDF_ENV_NAME: production               # label shown in logs (default: "ci")
  ZDF_IS_PRODUCTION: "true"             # set to trigger the production prompt guard
```

When all three are set, `getActiveEnv()` returns an `EnvironmentConfig` built from them
and ignores any config file. The token is fetched and cached in memory for the duration
of the process — **it is not written to disk in this mode** (no `saveUpdatedEnv` is called).

### Output isolation

Set `ZDF_OUTPUT_DIR` to a workspace path so pulled files land in a predictable location:

```yaml
env:
  ZDF_OUTPUT_DIR: ${{ github.workspace }}/zuora-state
```

Files written there (one JSON per resource) become the "source of truth" artifact.
Commit the directory to capture config state, or use it as an input for push operations.

### Exit codes and output parsing

- Exit `0` = success (`✔` message on stdout)
- Exit `1` = failure (`✖` message + error detail on stdout/stderr; thrown Error surfaced by `runCommand`)
- A tenant-config-blocked command exits `1` immediately with a human-readable message
- The bogus-id / resource-not-found path exits `1` with "Failed to pull … (see error above)"

In a pipeline, check `$?` after every `zdf` invocation. The `✔`/`✖` symbols on stdout
are for human readability — rely on exit codes in scripts, not output scraping.

### Commands safe to run in CI (read-only)

These make no writes to Zuora and are safe in any pipeline stage:
```
zdf pull <resource> <id> [--no-dependency]
zdf list orders [--account <key>] [--limit <n>]
zdf list billing-templates
zdf auth env
```

### Commands that write to Zuora

Use with explicit intent in deployment stages. Always gate with env checks:
```
zdf push <resource> <id>          # updates a resource
zdf create <resource> <name>      # creates a new record
zdf delete <resource> <id>        # deletes a record
```

### Commands with side effects

```
zdf create bill-run <name>        # EXECUTES BILLING — generates real invoices/memos
```

The CLI prints a warning before the network call, but in an automated pipeline that warning
may scroll past. Reserve this for dedicated billing-execution stages with explicit approval.

### Minimal GitHub Actions job sketch

```yaml
jobs:
  sync-zuora-catalog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build ZDF
        working-directory: zdf
        run: npm ci && npm run build

      - name: Pull Zuora product catalog
        env:
          ZDF_CLIENT_ID: ${{ secrets.ZUORA_CLIENT_ID }}
          ZDF_CLIENT_SECRET: ${{ secrets.ZUORA_CLIENT_SECRET }}
          ZDF_BASE_URL: ${{ secrets.ZUORA_BASE_URL }}
          ZDF_OUTPUT_DIR: ${{ github.workspace }}/zuora-state
        run: |
          node zdf/dist/zdf.js pull product ${{ env.PRODUCT_ID }} --no-dependency
          node zdf/dist/zdf.js pull product-rate-plan ${{ env.PRP_ID }} --no-dependency

      - name: Push updated config to Zuora
        if: github.ref == 'refs/heads/main'
        env:
          ZDF_CLIENT_ID: ${{ secrets.ZUORA_CLIENT_ID }}
          ZDF_CLIENT_SECRET: ${{ secrets.ZUORA_CLIENT_SECRET }}
          ZDF_BASE_URL: ${{ secrets.ZUORA_BASE_URL }}
          ZDF_OUTPUT_DIR: ${{ github.workspace }}/zuora-state
        run: |
          node zdf/dist/zdf.js push product-rate-plan ${{ env.PRP_ID }} --no-dependency
```

### Token persistence in CI

In env-var mode the token is NOT written back to any file (there is no config file to
update). Each ZDF process fetches a fresh token on first use and holds it in memory.
If a job runs many ZDF commands sequentially, they each fetch a new token independently —
no shared state between process invocations. For high-throughput pipelines that issue
hundreds of commands, consider batching them into a single Node.js script that imports
`getActiveEnv`/`ensureToken` directly rather than spawning a new process per command.
