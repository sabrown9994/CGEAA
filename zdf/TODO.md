# ZDF — Live `pull` Testing Findings & Resolution Status

Original testing exercised all 15 `pull` resource types against the live intQA Zuora
sandbox on 2026-07-29. Fixes were implemented and verified against live intQA on
2026-07-30 using the multi-agent development flow documented at the bottom of this file.

File/line references are to `src/`.

---

## Development flow (REQUIRED for all follow-on work on this repo)

All non-trivial changes to ZDF (and CGEAA) follow this process — see the full contract in
the "Required development flow" section at the end of this file:

1. **Multi-agent, subagent-driven**: a fresh implementer subagent per task, an independent
   reviewer after each task, then a whole-branch final review. Controller never fixes code
   itself.
2. **Dedicated adversarial tester**: one agent verifies every change starting from the
   assumption the change is wrong, trying to break it.
3. **Live intQA verification**: tests run against the live intQA Zuora sandbox
   (`rest.test.zuora.com`, active env in `zuora auth list`), **read-only** (`pull`/`list`/
   `auth` only — never `create`/`push`/`delete` against intQA).
4. **Output isolation**: all live test output goes to a temp dir via `ZDF_OUTPUT_DIR`
   (e.g. `/tmp/zdf-fix-test`), never the repo or a shared folder.
5. Every code change ships with Vitest tests; `npm run build` and `npm test` must pass.

---

## ❌ REMOVED (2026-08-19) — `zdf sync-diff` (git-diff → zdf actions CI/CD engine)

`sync-diff` was implemented (planner + `--apply` executor, live-verified against intQA) and then
**removed** on 2026-08-19. Reason: promotion between Zuora environments moved to Zuora's native
**Deployment Manager** API, which deploys config at the **component-type** level (whole
`workflows`, whole `productCatalog`, …) with **no object-level selection** — so a per-object
`git diff → create/push/delete` promotion pipeline cannot be built on it, and per-tenant internal
ids are not stable cross-environment identifiers anyway. ZDF is now scoped to three developer-CLI
use cases (config editing, test-data pull/push into lower envs, targeted automation like prod
product creation); promotion is Deployment Manager's job, handled outside ZDF. See
`docs/promotion-deployment-manager.md` and `CLAUDE.md` → "Scope & promotion". The `sync-diff`
source, command, tests, README section, and CLI registration were all deleted.

---

## COMPLETED (2026-07-30) — all verified live-PASS against intQA

### ✅ P0 — Error responses no longer written to disk as "success"
`src/helpers/zuora-response.ts` now exports `assertReadSuccess(body, label)`, applied on the
read path in `fetchAndWrite` (`dependency-graph.ts`) and the direct-`apiGet` pulls in
`workflows.ts`, `billing-templates.ts`, and `data-queries.ts`. Throws on `success === false`
or a populated `reasons`/`errors` array; treats "no `success` field + no errors" as OK (so
valid workflow objects, which have no `success` field, still pass). No file is written on
failure. **Live-verified:** `pull billing-template 1` now fails loudly (exit 1), writes nothing.

### ✅ P0 — `workflow` endpoint corrected
`src/commands/workflows.ts` `ENDPOINT` changed `/v1/api/workflows` → `/workflows`.
**Live-verified:** `pull workflow 1` returns the real workflow object ("Administration :
Create Order"). Write-side (create/push/delete) body shapes and a `filterUpdatableFields`
allowlist for `workflow` remain follow-ups (not live-tested per read-only constraint).

### ✅ P1 — Credit-memo / debit-memo items no longer dropped
`dependency-graph.ts` `fetchAllItems` now reads the sub-item array under `items` for
credit-memo and debit-memo (was `creditMemoItems`/`debitMemoItems`), while still storing
under `creditMemoItems`/`debitMemoItems` in the written file. Invoice (`invoiceItems`) left
unchanged (already correct). **Live-verified:** a credit-memo embedded 6 items, a debit-memo
1 item, matching raw `/items` GET counts.

### ✅ P1 — `apiQuery` + traversal now bounded
Three independent caps, each a named exported constant that emits `output.warn` (never
throws) when hit:
- `APIQUERY_MAX_ROWS = 5000` — `src/api/client.ts:72`, bounds ZOQL `queryMore` pagination.
- `MAX_TRAVERSAL_NODES = 500` — `src/helpers/dependency-graph.ts:17`, bounds total nodes
  visited in `resolveAndSync`.
- `FETCH_ALL_ITEMS_MAX = 5000` — `src/helpers/dependency-graph.ts:32`, bounds `fetchAllItems`
  pagination (added in final-review fix — the node ceiling alone did NOT prevent a `pull
  account` from enumerating a whole tenant's orders before it engaged).

### ✅ P1 — `list orders` bounded and filterable
`src/commands/orders.ts` gained `--limit <n>`, `--account <id>`, `--status <status>`, and
`--all`. With no flags it refuses to run and **exits non-zero** (throws → `process.exit(1)`),
preventing an accidental full-tenant export. **Live-verified:** `--limit 5` wrote exactly 5;
no-flags fetched nothing. (See open item #2 below — `accountId` filtering needs a different
endpoint.)

### ✅ P2 — Success messages show the real output path
All hardcoded `zdf-output/...` message strings (27 across 14 command files) now use
`resolveFilePath` / the new `getOutputDir()` export from `file-io.ts`, so messages reflect
`ZDF_OUTPUT_DIR` when set.

---

## COMPLETED (2026-08-05) — all implemented + live-verified on intQA

Implemented via the multi-agent 4-role loop (implementer → adversarial test-case author →
live intQA test executor → fix; plus per-task code review). Final: HEAD `5dab8d0`, 185 tests
passing, build clean.

### ✅ 1. `billing-template` — Settings API, HTML-only (get / list / update)
`src/commands/billing-templates.ts` rewritten for the Settings API (`/settings/invoice-templates`,
NOT `/v1/`-prefixed):
- `pull billing-template <id>`: rejects non-HTML (`templateFormat !== 'HTML'`); base64-decodes
  `base64EncodedTemplateFileContent`; JSON-validates; writes the decoded JSON as the file body
  under `<name>_<id>.json` (existing `sanitizeSegment`, lossy name OK, `id` authoritative).
- `list billing-templates`: `GET /settings/invoice-templates`, prints metadata.
- `update billing-template <id>`: reads `<name>_<id>.json`, base64-encodes, `PUT`s with an
  ALLOWLISTED body (`base64EncodedTemplateFileContent`, `name`, `defaultTemplate`,
  `suppressZeroValueLine`, `templateFileName`, plus `__c` custom-field passthrough), excluding the
  keys Zuora rejects (`associatedToBillingAccount`, `templateFormat`, `id`, `updatedOn`,
  `templateNumber`, `templateCategory`). Uses `assertReadSuccess` because the PUT response has no
  `success` field. `<id>` is `encodeURIComponent`-wrapped. create/delete removed (dead endpoint).
- **Live-verified:** lossless PUT round-trip on the authorized template
  `8a8aa02e9fd1baf0019fd2ea46473db6` ("HTML - ZDF POC") — md5 unchanged; non-HTML pull rejected.

### ✅ 2. `orders` account filtering — subscription-owner endpoint
`list orders --account` and the `rulesAccount` traversal now use
`GET /v1/orders/subscriptionOwner/{accountKey}` (the account NUMBER, not internal id); the generic
`?accountId=` was ignored by the tenant. `--status` filtered client-side when combined with
`--account`. **Live-verified:** scopes correctly (0-order account returns 0; injection-safe).

### ✅ 3. `order-line-item` pull — envelope bug fixed + create round-trip
Fixed a real bug: `rulesOrder` read `orderLineItems`/account number at the top level, but
`GET /v1/orders/{n}` wraps under an `order` key, so OLI traversal silently no-op'd on every real
order. Now unwraps (`record['order'] ?? record`). **Live-verified:** `pull order O-01339581`
creates its 2 OLI child files + account file; created authorized test order **O-01339583**
("TEST ZDF POC") and confirmed the OLI round-trip.

### ✅ 4. CLI cap control + `--no-caps` + progress indicator
Global flags `--max-rows`/`--max-nodes`/`--max-items` override the three caps per-invocation;
`--no-caps`/`--unbounded` disables all three (with a warning); an `ora` progress indicator (inert
off-TTY) reports pull progress. The `list orders` per-line-item loop is also bounded by the
effective items cap.

### ✅ Auth — reactive 401 refresh
`request()` now, on HTTP 401, forces a token refresh (`ensureToken(env, force)`) and replays once.
(Proactive expiry-based refresh already existed.)

### ✅ Pre-existing bug fixed — `pull account` bill-run child ZOQL
`rulesBillRun`'s DebitMemo/Invoice/credit-memo child lookups (which intQA rejects with 400
INVALID_TYPE) are now wrapped in try/warn/continue, so a full `pull account` with bill-runs no
longer aborts. **Live-verified:** `pull account ACG00018042` completes exit 0 with a warn line.

### ✅ Infra — `.gitignore` fix
Repo-root `.gitignore` bare `bin/` rule was silently ignoring `zdf/bin/zdf.ts` (the CLI entry
point). Added `!zdf/bin/` / `!zdf/bin/*.ts`; the CLI entry point is now tracked.

---

## VALIDATION — full framework live sweep against intQA

### Pull side: COMPLETE
Comprehensive adversarial live sweep of all 15 `pull` resource types against intQA, read-only,
output to a temp dir — HEAD `41a9be3`, 2026-08-06. All 15 resource types verified live; one defect
found and fixed (top-level pull now reports exit 1 when the fetch fails, instead of silently
exiting 0). Note: `billing-template` pull is HTML-only by design; `data-query` guard was
unit-tested but not recently re-verified live; a bill-run's debit-memo child branch is expected to
warn+skip (intQA rejects that ZOQL).

### Push side cycle test results (2026-08-07)
Live create/push/delete cycle test against intQA for the 6 newly-implemented resources plus the
corrected `product-rate-plan` endpoints. Each cycle used a self-contained created-then-mutated
record (marked `TEST ZDF POC` where applicable) and was torn down after confirmation, per the
"Preferred method" contract below.

| resource | create | push | delete | notes |
|----------|--------|------|--------|-------|
| product-rate-plan | PASS | — | PASS | endpoint corrected to `/v1/object/product-rate-plan` (see below); live-verified |
| product-rate-plan-charge | PASS | — | PASS (cascade) | requires `ProductRatePlanId` + `POBIdentifier__c` + `ProductRatePlanChargeTierData`; delete is cascade via parent PRP deletion, not a direct DELETE call |
| billing-template | PASS | PASS | PASS | full cycle PASS: create / confirm / push / delete / confirm-deletion all live-verified |
| bill-run | PASS | PASS (re-fetch) | ❌ REMOVED (2026-08-21) | create + pull + push-as-refetch verified. `delete bill-run` command REMOVED: Zuora only deletes Pending/Canceled runs, but an API-created run reaches Completed almost immediately, so delete would always be rejected — removed rather than left as a failing stub. |
| invoice | ✅ RESOLVED (2026-08-18) | PASS | PASS (cancel-then-delete) | `create` via `POST /v1/invoices` (flat body; accounting fields supplied per item — the "pass the fields" path, not a wall). `delete` cancels first then deletes, confirming via invoice-disappearance poll (async-jobs endpoint doesn't track the job). Full create→delete cycle live-verified on intQA. See "Resolved" note below. |
| credit-memo | ✅ VERIFIED (2026-08-19) | N/A | ✅ RESOLVED (2026-08-21, cancel-then-delete) | create `POST /v1/credit-memos/invoice/{invoiceKey}` requires `--invoice` (a **Posted** invoice) + body `{items:[{invoiceItemId,amount,skuName}]}` — live create→pull confirmed. delete is now status-aware: GET → Draft `PUT .../cancel` → DELETE; Cancelled deletes directly; Posted rejected. GET-first verified live; full cycle unit-tested. |
| debit-memo | ✅ VERIFIED (2026-08-19) | N/A | ✅ RESOLVED (2026-08-21, cancel-then-delete) | same as credit-memo (`POST /v1/debit-memos/invoice/{invoiceKey}`). Create live-verified; delete now GET→(Draft)cancel→delete, Posted rejected. |
| product | ✅ RESOLVED (Commerce API, 2026-08-18) | — | PASS | `create product` now uses `POST /commerce/products` (legacy `/v1/catalog/products` was 405-disabled); delete uses `DELETE /v1/object/product/{id}`. Full create→pull→delete cycle live-verified on intQA. See "Resolved" note below. |
| subscription | ❌ REMOVED (2026-08-18) | PASS | ❌ REMOVED (2026-08-18) | create/delete subcommands removed as permanently unsupported (Orders-enabled tenant disables legacy create; Zuora has no subscription DELETE endpoint). pull + push only. Use the Orders API for lifecycle. |

### Push side (self-contained validation method, for reference)
**Preferred method — self-contained via create-then-push:** for each pushable resource, if the
framework supports a `create` action for it, the validation should CREATE a fresh record first (so
we own it and can safely mutate/round-trip), then `push` an edit to that created record, then
confirm via `pull`. This avoids touching pre-existing tenant data.

- Resources WITH create (per resource-coverage table): account, contact, order,
  product, product-rate-plan, product-rate-plan-charge, billing-template, invoice, credit-memo,
  debit-memo, bill-run, workflow — use create-then-push.
- Resources WITHOUT a create action (order-line-item, subscription): create-then-push is NOT
  possible. For these, **ASK the user to create/provide a reference record in intQA** to push
  against (as was done for OLI order `O-01339581`). Do NOT push against arbitrary pre-existing
  tenant records without explicit authorization. (subscription has pull/push only — no create/delete.)
- All created/mutated records must carry a clear test marker (e.g. name/description contains
  `TEST ZDF POC`) and each push must be a controlled, reversible/lossless change where possible.
- Note: `push bill-run` is a re-fetch (no PUT endpoint) — validate accordingly.

### Endpoint corrections (live discovery, 2026-08-07)
- **`product-rate-plan` create**: was `POST /v1/rateplan` — this path does not exist on the intQA
  tenant. Corrected to `POST /v1/object/product-rate-plan` (the legacy object endpoint, PascalCase
  `{Id,Success,Errors?}` response). Live-verified.
- **`product-rate-plan` delete**: was `DELETE /v1/rateplan/{id}` — corrected to
  `DELETE /v1/object/product-rate-plan/{id}`. Live-verified.
- **`contact` create**: the response is a direct contact object with no `{success}` envelope (unlike
  every other write endpoint in this framework). Corrected to use `assertReadSuccess` and read
  `res.id` (lowercase). Live-verified.

---

## Tenant-config limitations (not currently supported)

The following actions are blocked by **tenant configuration** on this Zuora environment
(intQA), not by a limitation of the Zuora API or of ZDF itself. Each is guarded in the CLI
(`src/helpers/delete-guard.ts` — `checkTenantSupported` / `checkDeleteAllowed`) so the command
fails immediately with a clear message instead of making a network call that returns a
confusing Zuora error.

### `create product` — ✅ RESOLVED (2026-08-18, Commerce API)
- **Previously blocked because:** `POST /v1/catalog/products` returns HTTP 405 (disabled) on
  this tenant.
- **Resolution:** re-pointed `create product` to the modern **Commerce API**
  `POST /commerce/products` (which IS enabled on intQA and creates product + plan + charge in
  one call). Delete uses `DELETE /v1/object/product/{id}`. The tenant `checkTenantSupported`
  block for product was removed. Full create → pull → delete cycle live-verified on intQA.
- **Caller responsibility:** the Commerce request body (snake_case) must include `pricing`
  (object keyed by currency), a full `accounting` block (8 finance accounts non-blank), and the
  tenant-required custom fields (`item__c`, `productfamily__c` on the product;
  `pobidentifier__c`, `pobname__c` on the charge). See `CLAUDE.md` → "Product create — Commerce
  API" for the reference body.

### `create subscription` / `delete subscription` — ❌ REMOVED (2026-08-18, permanently unsupported)
Both subcommands were removed from ZDF entirely (commit dbee8c1). `subscription` now supports
**pull and push only**.
- **`create subscription`**: Orders-enabled tenants disable the legacy Subscriptions-create API
  (`53000010: Subscription api cannot be used when order is enabled.`). This is not a tenant
  toggle to flip — it's the intended behavior for Orders tenants. Use the Orders API
  (`create order`) to establish subscriptions.
- **`delete subscription`**: the Zuora REST API exposes no DELETE endpoint for subscriptions at
  all (a permanent API limitation). Cancel via the Orders API or the Zuora UI.
- Because these are permanently unsupported (not "waiting on a tenant setting"), the commands and
  their guard entries were deleted rather than left as fail-fast stubs.

### `create invoice` — ✅ RESOLVED (2026-08-18)
- **What it is:** Standalone invoice creation (independent of a bill run).
- **Previously blocked because:** `POST /v1/invoices` returned `68000022` — the tenant does not
  default the Finance > Manage Non-Subscription Items accounting settings.
- **Resolution:** the `68000022` error explicitly says "*either pass the fields or configure the
  defaults*." We reached that accounting-validation step (not a permission/403), so the OAuth
  client already has standalone-invoice permission — the only gap was the accounting fields.
  `create invoice` now posts the body verbatim (guard removed); the **caller supplies** the
  accounting fields per invoice item (`revenueRecognitionRuleName` + 8 accounting codes, plus
  `amount` and `yyyy-MM-dd HH:mm:ss` date fields). Full create→cancel→delete cycle live-verified
  on intQA. See `CLAUDE.md` → "Invoice create / delete" for the reference body.
- **Also fixed:** `delete invoice` now cancels the (Draft) invoice before deleting, and confirms
  completion by polling the invoice resource for disappearance (the DELETE `jobId` is not trackable
  via `/v1/async-jobs/{jobId}` — that endpoint returns "Cannot find response for job").

---

## Backlog (deferred minors from the fix effort)

- ✅ **DELIVERED (2026-08-21) — cross-tenant env-id map & upsert** (SDD plan
  `docs/superpowers/plans/2026-08-21-cross-tenant-upsert.md`). Per-file `_zdf` map (keyed by active
  env name; stripped before send); `pull` populates + accumulates it; `push` = upsert (verify mapped
  id / natural-key search → update, else create) for account/product/invoice/credit-memo/debit-memo;
  bill-run is id-map-on-pull only. FK remap: invoice→account by number; memo→invoiceItemId by
  skuName+amount item matching. Helpers: env-map.ts, upsert.ts, upsert-command.ts; file-io
  readResourceFileIfExists / readResourceFileByIdOrName. Unit + real-fs integration tests; 423 tests.
  **Known limitations:** (1) the UPDATE path is fully supported; CREATE-into-empty-target from a
  *pulled* file can hit pull-shape-vs-create-shape mismatches (use `zdf template` / a create-shaped
  file). (2) product & bill-run are id-named (endpoints reject their natural key), so their local
  files don't unify across tenants like natural-key-named resources. (3) **Live A→B: the account
  update path is verified across two real tenants (intQA↔StagingUAT, 2026-08-24)** — pull in one →
  push in the other resolves by natural key to the other tenant's different internal id, updates it,
  `_zdf` accumulates both, and re-push is idempotent; the create-into-empty-target path was
  live-confirmed to hit the shape limitation in (1) with a clear error. Invoice FK remap / memo
  item-matching remain unit + real-fs tested only (server-assigned invoice/memo numbers can't be
  aligned across two independent sandboxes to run their update path live).

- ✅ **RESOLVED (2026-08-21) — dependent-pull failures are now collected and surfaced.** Every
  dependency discovery lookup (contacts/orders/subscriptions/invoices/credit-memos/debit-memos/
  bill-runs/product-rate-plans/charges) is wrapped (`traverseCategory`), and individual child
  fetch failures are attributed to their parent (via a `parent` threaded into `fetchAndWrite`).
  At the end of each top-level pull, `emitDependencyFailureSummary()` logs one consolidated
  warning per parent — e.g. `Some dependent objects of bill-run BR-001 were not pulled: invoices
  (…); debit-memos (…)`. The primary object still pulls successfully (never aborts, never a
  corrupt file); `getDependencyFailures()` exposes the structured list for tests/tooling.
  Previously a failing lookup in `rulesAccount` could abort the whole account pull; now it
  degrades gracefully and is reported.
- ✅ **RESOLVED (2026-08-21) — `workflow` full CRUD incl. in-place LOGIC editing.** Reworked to
  Zuora's export/import model: `pull` = `GET /workflows/{id}/export` (full active-version
  definition), `create` = `POST /workflows/import` (new workflow), `delete` = `DELETE /workflows/{id}`.
  **`push` = `POST /workflows/{id}/versions/import?version=<next>&activate=true`** — imports the
  edited definition as a NEW ACTIVE VERSION, applying task/linkage **logic** + version settings
  (`version` is a query param, auto-bumped above the latest via `nextWorkflowVersion`; `--version`
  overrides; `--no-activate` skips activation). Live-verified end-to-end with a **from-scratch**
  definition: create → pull → **push that ADDS a task** (re-pull confirmed the edited task graph is
  the active version, version 1.0→2.0) → delete → confirm-gone. (An earlier claim that logic can't
  be edited in place was WRONG — it missed the `?version=` query param on versions/import.)
- ✅ **RESOLVED (2026-08-21) — spurious "truncated" warning at exact pagination boundaries.**
  Confirmed the bug: `fetchAllItems` checked the item cap BEFORE reading `nextPage`, and
  `list orders --limit` flagged truncation whenever `total >= limit` after a full page. Both now
  only warn when more actually remains (a `nextPage`/unwritten orders exist). A final page landing
  exactly on the cap/limit with no next page no longer warns.

### Known tenant-config limitations (intQA, discovered 2026-08-07)
- `create invoice` (standalone `POST /v1/invoices`) — ✅ RESOLVED (2026-08-18): the tenant doesn't
  default the accounting settings, but the API accepts them per invoice item ("pass the fields"
  path). Create now posts the caller-supplied accounting fields; `delete invoice` cancels-then-deletes.
  Live-verified. No longer blocked.
- `create subscription` / `delete subscription` — ❌ REMOVED (2026-08-18), permanently
  unsupported (Orders-enabled create block + no Zuora subscription DELETE endpoint). pull/push only.
- `create product` — ✅ RESOLVED (2026-08-18): the legacy `/v1/catalog/products` is 405-disabled,
  but `create product` now uses the Commerce API `POST /commerce/products` (enabled on intQA).
  Live-verified. No longer blocked.
- `create invoice` — ✅ RESOLVED (2026-08-18): "pass the fields" path; not tenant-blocked. See above.
- `create credit-memo` / `create debit-memo` — ✅ VERIFIED (2026-08-19). NOT blocked by Invoice
  Settlement (it's enabled). Create posts the local file verbatim to
  `POST /v1/{memo}s/invoice/{invoiceKey}`; requires `--invoice <id>` pointing at a **Posted** invoice
  and body `{ items: [ { invoiceItemId, amount, skuName } ] }` (each item needs all three; `skuName`
  must be non-blank). Live create→pull confirmed (Draft memo with items). Source invoices can be made
  Posted with `create invoice --post`.
- ✅ **RESOLVED (2026-08-21) — `delete credit-memo` / `delete debit-memo` on invoice-sourced memos.**
  Root cause (confirmed against Zuora API docs): Zuora only deletes a **Cancelled** memo, and only a
  **Draft** memo can be cancelled — the old code did a blind `DELETE /v1/{memo}s/{id}`, which a Draft
  memo rejects. Fix: `delete {memo}` now GETs the memo first, then Draft → `PUT /v1/{memo}s/{id}/cancel`
  → `DELETE`; already-Cancelled → `DELETE` directly; **Posted → rejected** (a posted memo can't be
  cancelled). No unapply step is needed because a Draft memo isn't applied yet (application happens on
  posting). GET-first behavior verified live on intQA; Draft/Cancelled/Posted branches unit-tested.
  Full create→cancel→delete cycle **now live-verified end-to-end (2026-08-21)**: created a
  throwaway account → Posted invoice → Draft credit + debit memos → `zdf delete {memo}`
  (GET → cancel → delete) → both confirmed gone; throwaway account cascade-deleted.
- ✅ **RESOLVED (2026-08-21) — env-var (CI) auth was broken.** `ensureToken` called `saveUpdatedEnv`
  unconditionally; in env-var mode there's no config file, so the first successful token fetch threw
  `No ZDF configuration found` — breaking every authenticated command in CI. Fix: `getActiveEnv` marks
  env-var envs `fromEnv: true`, and `ensureToken` caches the token in memory (per `clientId`) for those
  instead of persisting. Verified live against a local token server (env-var mode + no config file now
  completes); regression tests added.
- ✅ Error logging (2026-08-19): `handleAxiosError` now surfaces the real Zuora detail for all body
  shapes (reasons/errors/PascalCase Errors/Settings messages+errorCode/FaultMessage) via
  `extractZuoraErrors` — no more bare "HTTP 400". This is how the memo `skuName`/`not posted` errors
  were diagnosed.
- ✅ `create invoice --post` (2026-08-19): injects `status:Posted` at create (warns it's then
  non-deletable). `delete invoice` now rejects Posted invoices up front. Note: no API path posts an
  already-existing Draft invoice on this tenant.
- `delete bill-run` on a Completed bill-run — Zuora rejects by business rule; only
  Pending/Canceled bill-runs can be deleted. Not a ZDF defect.

---

## ZOQL acceptance (audited, no action needed)
Every ZOQL query the traversal actually issues (Contact/BillRun/ProductRatePlan/
ProductRatePlanCharge/Invoice/DebitMemo, all with WHERE clauses) returned clean 200s against
intQA. The 400s in the original finding were from ad-hoc probe queries not issued by ZDF code.

---

## Billing-template Settings API investigation (2026-08-05, live read-only on intQA)

**Both Settings API endpoints WORK on intQA** (note: Settings API root, NOT `/v1/`-prefixed):
- `GET /settings/invoice-templates` → **HTTP 200**, returned **34 templates**. List items carry
  metadata only (`id`, `name`, `templateNumber`, `templateFileName`, `templateFormat`,
  `templateCategory`, `defaultTemplate`, `suppressZeroValueLine`, `associatedToBillingAccount`,
  `updatedOn`) — **no** file content in the list.
- `GET /settings/invoice-templates/{id}` → **HTTP 200**, same metadata PLUS
  `base64EncodedTemplateFileContent` (the actual template file).
- Update endpoint (`PUT /settings/invoice-templates/{id}`) not exercised (write; off-limits on
  intQA under the read-only rule).

**Key finding on the base64 content — it depends on `templateFormat`:**
- **HTML templates** (7 of 34): the base64 decodes to **JSON** (an editor/design config, e.g.
  `{"design":{"counters":{...}}}`). These ARE the JSON config files — editable, and a clean
  base64 decode → edit JSON → base64 encode round-trip should work.
- **WORD templates** (27 of 34): the base64 decodes to a **legacy binary Microsoft `.doc`**
  (OLE2 compound file, magic `d0cf11e0a1b11ae1`), NOT JSON. You cannot meaningfully edit these
  as JSON — they're binary documents. Pull can still save/round-trip the raw bytes, but "edit
  the JSON config" only applies to HTML-format templates.

**Implications for wiring the `billing-template` resource:**
- Repoint pull to `GET /settings/invoice-templates/{id}`; add `list` via
  `GET /settings/invoice-templates`.
- On pull: base64-decode `base64EncodedTemplateFileContent`. For HTML templates, write the
  decoded JSON so it's human-editable; for WORD templates, write the decoded bytes to a `.doc`
  sidecar (or keep the base64 as-is) and mark it non-JSON-editable.
- On push: re-encode to base64 and `PUT`. Straightforward for HTML/JSON; for WORD you'd be
  round-tripping an opaque binary. Recommend enabling push for HTML-format templates first.
- User will provide a specific template name + its JSON when it's time to prove the
  HTML encode/decode round-trip.

---

## Auth — token refresh is fully handled under the hood (proactive + reactive)
`src/auth/token.ts` `ensureToken(env)` already refreshes the OAuth token transparently: on
every request it checks `tokenExpiresAt > Date.now()` and, if expired/missing, fetches a new
`client_credentials` token and persists it via `saveUpdatedEnv`. No user action needed — this
is the abstracted refresh the request asked for, and it already exists.

**✅ RESOLVED (this note was stale):** reactive 401 refresh now exists. `request()` in
`src/api/client.ts` (lines ~45-59) catches a 401, calls `ensureToken(env, true)` to force a
refresh, and replays the request exactly once before surfacing the error — plus the proactive
expiry-based refresh. One retry only (no loop).

---

## Required development flow (full contract)

**Any substantive change to this repo MUST use this flow** — this is a hard project
requirement, not a suggestion.

**Multi-agent, subagent-driven execution:**
- Break the work into a written plan of discrete tasks.
- Dispatch a **fresh implementer subagent per task** (no shared/inherited context) — give it
  only the task brief, the interfaces it touches, and the global constraints.
- After each task, dispatch an **independent reviewer** that checks both spec compliance and
  code quality. Findings enter a fix loop (resume implementer, re-review) until clean.
- Never let the controller fix code directly — it stays clean for coordination.
- After all tasks, run a **whole-branch final review** on the most capable model, then one
  fix wave + scoped re-review for any findings.

**Dedicated adversarial tester:**
- One agent's sole job is to verify the changes **starting from the assumption they are
  wrong** and actively trying to break them — not to confirm they work.

**Live intQA testing (read-only):**
- Verify against the live intQA Zuora sandbox (`rest.test.zuora.com`), which is the active
  environment in `cgeaa zuora auth list` / `~/.zdf/config.json`.
- **Read-only only**: `pull`, `list`, `auth` (read) subcommands. **Never** run `create`,
  `push`, or `delete` against intQA.
- Set `ZDF_OUTPUT_DIR` to a temp directory (e.g. `/tmp/zdf-fix-test`) on every live
  invocation — never write test output into the repo or a shared folder. Clean it up after.
- Use `--no-dependency` to isolate single-resource tests and avoid large traversals.

**Verification gates (every task):**
- Ship Vitest tests with every code change (mocks use `vi.hoisted(() => vi.fn())`).
- `cd zdf && npm run build` succeeds and `cd zdf && npm test` passes before a task is done.
