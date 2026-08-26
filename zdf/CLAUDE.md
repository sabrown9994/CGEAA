# ZDF — Claude Code Context

ZDF (Zuora Development Framework) is a TypeScript CLI that syncs Zuora billing objects
to local JSON files, edits them, and pushes changes back — with dependency-aware traversal.
See `README-ZDF.md` for the full user-facing reference and `TODO.md` for known limitations and
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
`GET /v1/invoices/{id}/items`. **Create is live-verified** (Draft memo with items).

**Delete** (`delete credit-memo` / `delete debit-memo`) — RESOLVED 2026-08-21, status-aware
cancel-then-delete. Zuora only deletes a **Canceled** memo and only cancels a **Draft** one, so
the command GETs the memo first: `Draft` → `PUT /v1/{memo}s/{id}/cancel` → `DELETE`; already
`Canceled` → `DELETE`; any other status (`Posted`, `Error`, `PendingForTax`, `Generating`,
`CancelInProgress`, or missing) → rejected with a clear message (no blind DELETE). No unapply
step is needed — a Draft memo isn't applied to its invoice yet (application happens on posting).
Status spelling is Zuora's single-L `Canceled`. **Live-verified end-to-end (2026-08-21):**
account → Posted invoice → Draft credit + debit memos → `zdf delete {memo}` (GET → cancel →
delete) → both confirmed gone, throwaway account cascade-deleted. Branches also unit-tested.

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

### bill-run push / no delete

Zuora has no PUT endpoint for bill runs. `push bill-run` re-fetches (same as pull) rather than
writing anything. **There is no `delete bill-run` command** (removed 2026-08-21): Zuora only
deletes Pending/Canceled runs, but an API-created run reaches Completed almost immediately, so a
delete would always be rejected — the command was removed instead of left as a failing stub.

### Workflows API — export/import model

Base path `/workflows` (not `/v1/api/workflows`). Workflows are handled via the **export/import**
API so the local file is the FULL, recreatable definition, not just metadata:

- **pull** → `GET /workflows/{id}/export` → writes `{ workflow_definition, workflow, tasks,
  linkages }`. (NOT `GET /workflows/{id}`, which returns only metadata + active_version.)
- **create** → `POST /workflows/import` with the export JSON body → creates a **NEW** workflow
  (new definition id; import never updates in place). Response is the workflow object directly
  (no `{success}` envelope) → `assertReadSuccess`, read `res.definitionId ?? res.id`. An import
  payload must contain **≥1 task and ≥1 linkage** (empty arrays are rejected 400).
- **push** → `POST /workflows/{id}/versions/import?version=<next>&activate=true` with the edited
  `/export` body. This imports the edited definition as a **new active version** of the existing
  workflow, applying **task/linkage logic AND version settings** — Zuora's supported in-place edit.
  The `version` is a **query param** (must be numerically greater than every existing version;
  `nextWorkflowVersion()` bumps the highest major → `<major+1>.0`, override with `--version`);
  `activate=true` (default; `--no-activate` to skip) makes it the active version in the same call.
  Response is the workflow object directly (no `{success}`) → `assertReadSuccess`. Each push adds a
  version (Zuora keeps history). CAUTION: `POST /workflows/import` (no `/{id}/versions`) instead
  creates a whole NEW workflow definition — that's `create`, not `push`.
- **delete** → `DELETE /workflows/{id}` → returns `{ success, id }` → `assertSuccess`.
- **Live-verified end-to-end (2026-08-21):** authored from scratch → create → pull → **push that
  ADDS a task** (re-pull confirmed the new task graph is the active version, version bumped
  1.0→2.0) → delete → confirm-gone. (An earlier note that logic couldn't be edited in place was
  WRONG — it missed the `?version=` query param on the versions/import endpoint.)

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
- **invoice/credit-memo/debit-memo** push/delete → parent account; invoice/credit-memo also → bill-run (invoice via `billRunId`, credit-memo via `sourceId`) on every action
- **bill-run** (always) → parent account, invoices (ZOQL), credit-memos, debit-memos (ZOQL)

**Standalone (no edges, never traversed):** `workflow`, `billing-template`, `data-query`. These
are absent from `ENDPOINTS`/`applyRules` in `dependency-graph.ts` entirely, so they are always
fetched/written alone regardless of `--no-dependency`. This is intentional and matches use
case 1 (config editing pulls a workflow/template without dragging in unrelated objects). Adding
a traversal edge for one of these would be a behavior change, not a bug fix.

**Dependent-pull failure collection.** Every discovery lookup runs through `traverseCategory`
(wraps the ZOQL/GET in try/catch), and individual child fetch failures are attributed via a
`parent: {resource,id}` threaded into `fetchAndWrite`. Both push into a per-pull
`dependencyFailures` collector (reset at each top-level `resolveAndSync`, i.e. `parent ===
undefined`). When the top-level traversal finishes, `emitDependencyFailureSummary()` logs ONE
consolidated `output.warn` per parent: `Some dependent objects of <parent> were not pulled: <cat>
(<reason>); …`. The primary object still succeeds (a failed category never aborts the pull);
`getDependencyFailures()` exposes the structured list (used in tests). This generalizes the old
`rulesBillRun`-only tolerance to ALL parents and makes the omissions visible.

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
| credit-memo | ✓ | ✓ | ✓ (`--invoice <id>` required; `skuName` per item) | ✓ (Draft→cancel→delete; Cancelled direct; Posted rejected) | |
| debit-memo | ✓ | ✓ | ✓ (`--invoice <id>` required; `skuName` per item) | ✓ (Draft→cancel→delete; Cancelled direct; Posted rejected) | |
| bill-run | ✓ | re-fetch (no PUT) | ✓ (⚠ executes real billing) | — (removed; API-created runs reach Completed, undeletable) | |
| workflow | ✓ | ✓ | ✓ | ✓ | |
| billing-template | ✓ (HTML only) | ✓ | ✓ | ✓ | ✓ |
| data-query | ✓ | | ✓ (submits job) | ✓ (cancels job) | |

See `TODO.md` "Tenant-config limitations" for details on the ✗ blocked entries and what
would need to change to enable them.

## Scope & promotion — why ZDF is NOT a CI/CD pipeline

ZDF is a **developer CLI for interacting with Zuora tenants** (one active tenant at a time — the
selected `auth` environment), not a promotion pipeline. It has exactly three in-scope use cases:

1. **Config editing** — pull/push `workflow` and `billing-template` between Zuora and the IDE,
   so they can be edited with Claude Code or other AI tooling.
2. **Test data** — sync financial/test data (account, contact, subscription, order,
   order-line-item, invoice, credit-memo, debit-memo, bill-run) into **lower** environments for QA
   and bug repro. `push` is a cross-tenant **upsert** for the resources with a stable unique key
   (account, product, invoice, credit-memo, debit-memo): it resolves the record's id in the ACTIVE
   tenant via the in-file `_zdf` env-id map (verify) or a natural-key search, then updates it; if it
   doesn't exist there it creates it. See "Cross-tenant env-id map / upsert" below and
   README-ZDF.md → "Cross-Tenant Sync". Both paths are supported: the create-into-empty-target case
   is handled by per-resource **create-shape adapters** (`src/helpers/create-shape.ts`) that
   transform the *pulled* GET shape into the create-API body (account, invoice, credit/debit-memo) —
   so a net-new record can be created in a lower env from a pulled file. **product** is the
   exception: its net-new creation still needs `zdf template product` + `create` (a Commerce body
   can't be reconstructed from the product object-GET — no plan/charge/pricing/accounting), so
   product cross-tenant is search-by-SKU + UPDATE only.
3. **Targeted automation** — scripted one-off tasks such as creating products (and their rate
   plans / charges) in production from a ticket.

**Resource → use case** (see the "Resource coverage" matrix above for verbs per resource):

| Use case | Resources |
|---|---|
| 1 · config editing | `workflow`, `billing-template` |
| 2 · test data | `account`, `contact`, `subscription`, `order`, `order-line-item`, `invoice`, `credit-memo`, `debit-memo`, `bill-run` |
| 3 · automation | `product`, `product-rate-plan`, `product-rate-plan-charge` |
| utility | `data-query` (submits ZOQL export jobs; standalone, no traversal) |

The product catalog (`product`/`product-rate-plan`/`product-rate-plan-charge`) can also serve as
test data (use case 2); its primary listed use here is prod automation (use case 3).

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

## Production write policy

`src/helpers/command-policy.ts` (pure) classifies each command by **verb**
(`pull`/`list`/`auth` = read; `create`/`push`/`delete` = write) and **resource class**
(`RESOURCE_CLASS`: config = workflow/billing-template; catalog = product/product-rate-plan/
product-rate-plan-charge; financial = account/contact/subscription/order/order-line-item/invoice/
credit-memo/debit-memo/bill-run; utility = data-query). `decideProductionPolicy(...)` returns
`allow | confirm | block`:

- non-production → `allow` (writes proceed, no prompt);
- production + read → `allow`;
- production + write + **financial** → `block` unless `--allow-prod-financial` /
  `ZDF_ALLOW_PROD_FINANCIAL=true` (then `confirm`);
- production + write + config/catalog/utility → `confirm`;
- production + write + **unknown resource** → `block` (unknown treated as financial; safest).

**Wiring:** the program is built in `src/program.ts` (`buildProgram()`); `bin/zdf.ts` is a thin
shim that calls `buildProgram().parseAsync(process.argv)`. `buildProgram` registers a Commander
`preAction` hook that records `{verb, resource}` via `setInvokedCommand()` (verb =
`actionCommand.parent.name()`, resource = `actionCommand.name()`). `runCommand`
(`command-runner.ts`) reads it with `getInvokedCommand()`, calls `decideProductionPolicy`, and on
`block` throws (→ exit 1), on `confirm` calls `confirmProduction(envName, { assumeYes })`.

**Fail-safe when context is missing:** if `getInvokedCommand()` returns `null` (an in-process
caller invoked `runCommand` without going through the CLI hook), the policy can't classify the
resource, so it does NOT silently allow: on a **production** env it warns and requires
confirmation (`confirmProduction` — needs `--yes`/`ZDF_ASSUME_YES` or a TTY, fail-fasts in CI);
on non-production it proceeds. The extracted `buildProgram()` lets the integration test
(`src/__tests__/integration/prod-policy-wiring.test.ts`) drive the real program end-to-end so a
regression in the hook/plumbing fails a test.

**Confirmation** (`src/helpers/production-guard.ts`): `assumeYes` (`-y`/`--yes` or
`ZDF_ASSUME_YES=true`) → proceed with a notice; else if `process.stdin.isTTY` is falsy →
**throw** (never hang in CI); else inquirer prompt, declined → `throw new Error('Aborted by
user.')` (runCommand maps that message to exit 0). See README → "Production Safety" for the
user-facing contract.

## Cross-tenant env-id map / upsert

Moves a resource between tenants despite per-tenant internal ids. In-file `_zdf` map keyed by the
active `auth` env name, each `{ id, key }`; ALWAYS stripped before send (`stripEnvMap`). Scope:
account, product, invoice, credit-memo, debit-memo (upsert); bill-run (id-map on pull only,
`upsertable:false`). Config in `resource-registry.ts` `CROSS_TENANT` (zoqlObject/zoqlKeyField).

Key modules/functions:
- `src/helpers/env-map.ts`: `ENV_MAP_KEY='_zdf'`, `stripEnvMap`, `getEnvEntry`, `setEnvEntry`
  (merges, preserves other envs), `activeEnvName()`, `mergeExistingEnvMap(resource,id,record)` (reads
  the existing local file by its **write filename** `fileNameFor(...)` and folds in OTHER envs'
  entries so the map ACCUMULATES rather than being overwritten by a fresh fetch).
- `src/helpers/upsert.ts`: `crossTenantKeyValue(resource,record)` (body natural key), `searchByKey`
  (ZOQL, single-quote-escaped, 1-row-only), `verifyId` (GET, never throws → bool),
  `resolveTargetId(resource,record) → {id,found}` (verify mapped id → else key-search → else not
  found), `matchInvoiceItems(memoItems,targetItems)` (match by skuName+amount; throws on
  no-match/ambiguous).
- `src/helpers/upsert-command.ts`: shared command glue — `getOrCreate`, prior-map capture, and
  `carryForwardEnvMapToFile` (after write, re-read the file and fold the in-memory prior map's
  other-env entries in — needed because id-keyed resources like product can't re-find the old file).
- `src/helpers/create-shape.ts`: **create-shape adapters** — `toAccountCreateBody` /
  `toInvoiceCreateBody` / `toMemoCreateBody` map a *pulled* GET-shape record to the flat create-API
  body (drop read-only/ids/`_zdf` via allowlists; never spread the raw record). Wired into the push
  CREATE (target-not-found) branch. Field-shape notes (live-verified 2026-08-24): the pulled account
  contact nests its postal code under `zipCode` (not `postalCode`); the pulled invoice item exposes
  its amount as `chargeAmount` (mapped → `amount`); a pulled invoice carries `accountId`, NOT
  `accountNumber`. Product has NO create-shape adapter by design (Commerce body unreconstructable
  from the object-GET) — net-new product = `zdf template` + `create`.
- `src/helpers/file-io.ts`: `readResourceFileIfExists` (EXACT filename, no id-scan — for the merge
  lookup) and `readResourceFileByIdOrName` (exact name → `findByStoredId` id-scan fallback,
  non-throwing — for locating a sibling file when the ref may be an id OR a natural key, e.g. the
  invoice→account and memo→invoice FK lookups). `findByStoredId` matches `recordId` OR any
  `_zdf[env].id` — so a record stays findable by its id in ANY tenant it's known in (needed because a
  cross-tenant push re-fetches from the target, changing the file's own id to the target's, while
  sibling FKs still hold the source id).
- `pull` populates `_zdf[active]` centrally in `dependency-graph.ts` `fetchAndWrite` for every
  `CROSS_TENANT` resource. `push`/`create` in the account/product/invoice/memo commands do the
  upsert (see R6/R7 rulings in the plan / commit messages).
- **FK remap:** invoice→account resolved by the pulled invoice's `accountId` (a SOURCE-tenant id →
  the sibling account file found via `findByStoredId`'s `_zdf`-aware match → its `_zdf[active].key`
  = target accountNumber, injected on the CREATE branch — accountNumber isn't in the invoice PUT
  allowlist so the update branch skips it); memo→invoiceItemId via the source-invoice file's
  `_zdf[active]` + `matchInvoiceItems`.

**Verification reality (live-verified A→B, 2026-08-24, intQA↔StagingUAT — two real tenants on
rest.test.zuora.com):**
- **account** — create-into-empty via `toAccountCreateBody` (pull in intQA → push in StagingUAT
  where absent → CREATED), plus UPDATE + idempotent re-push (PUT the mapped id, no duplicate); `_zdf`
  accumulated both envs' distinct ids. (An earlier raw-pulled-body push was rejected — the adapter
  is what makes create-into-empty work.)
- **invoice** — create-into-empty via `toInvoiceCreateBody` (CREATED in StagingUAT; item amount
  landed correctly via `chargeAmount`→`amount`; account FK resolved from the sibling account's
  `_zdf[StagingUAT].key`; stale source file cleaned up), plus idempotent re-push (PUT).
- **product** — search-by-SKU → UPDATE the pre-existing StagingUAT product (SKU-named file resolved
  the different target id), idempotent.
- No duplicates created (verified counts); all throwaway data deleted in both tenants afterward.
- **credit/debit-memo** cross-tenant create is NOT live-verifiable here: a standalone
  (non-subscription) invoice item has no `skuName`, which the memo item-matcher + invoice-scoped memo
  create both require. Covered by unit + real-filesystem integration tests
  (`cross-tenant-env-map.test.ts`, `memo-cross-tenant-create.test.ts`). `toMemoCreateBody`'s header
  fields (comment/reasonCode/effectiveDate) are therefore not yet live-confirmed on that endpoint —
  the body is a strict superset of the previously-verified `{ items }`, so a rejected field would be
  a one-line trim.

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

In env-var mode (`getActiveEnv` returns `fromEnv: true`) there is no config file to write
to, so `ensureToken` does NOT call `saveUpdatedEnv` — instead it caches the token in a
module-level in-memory map (`src/auth/token.ts`, keyed by `clientId`), reused for the life
of the process. Within a single process, repeated API calls reuse that cached token; a new
process re-fetches. (Before this was added, `ensureToken` called `saveUpdatedEnv`
unconditionally, which threw `No ZDF configuration found` in env-var mode after the first
successful token fetch — env-var auth was effectively broken. Fixed 2026-08-21; regression
tests in `src/__tests__/auth/token.test.ts`.) For high-throughput pipelines that issue
hundreds of commands, you can still batch into a single Node.js script — see the caveat
below about the production write policy.

> ⚠️ **Such a batching script bypasses the CLI entirely** (`buildProgram`/`runCommand`/the
> preAction hook), so it also bypasses the **production write policy** (financial-write block +
> confirmation). If you write one, do your own environment/resource gating, or route writes
> through `runCommand` so `decideProductionPolicy` still applies. Prefer per-command
> `node dist/zdf.js …` invocations when writing to production.
