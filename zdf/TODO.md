# ZDF — TODO & Known Limitations

This file tracks the standing development process contract, by-design limitations, and
remaining work items. See `CLAUDE.md` for architecture details and `README-ZDF.md` for the
complete user reference.

---

## Required development flow (MUST follow for all substantive work)

**Any substantive change to ZDF (or CGEAA) MUST use this flow** — this is a hard project
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

---

## Known limitations (by design)

These are intentional scope boundaries, not defects:

### Resources with limited verb support
- **subscription**: pull + push only (no create/delete) — Orders-enabled tenants block the
  legacy Subscriptions-create API, and Zuora has no DELETE endpoint for subscriptions. Use
  the Orders API (`create order`) for lifecycle operations.
- **order-line-item**: pull + push only (no create/delete) — line items are managed via their
  parent order.
- **bill-run push**: re-fetches the record (same as pull) — Zuora has no PUT endpoint for bill runs.
- **bill-run delete**: not supported — Zuora only deletes Pending/Canceled runs, but an
  API-created run reaches Completed almost immediately, making delete always rejected. Removed
  as a permanently-failing stub.
- **data-query push**: not supported — a data query is a job submission, not a mutable resource.

### Product net-new creation
**Product** cross-tenant push is search-by-SKU + UPDATE only. Creating a net-new product in an
empty target requires `cgeaa zuora template product` + `cgeaa zuora create product` (the Commerce API body
includes plan/charge/pricing/accounting and cannot be reconstructed from the pulled object-GET
shape). See `CLAUDE.md` → "Product create — Commerce API".

### Billing-template format support
**HTML templates only.** WORD-format templates are not pullable — their content is a binary
`.doc` (OLE2 compound file), not editable JSON. `pull billing-template` rejects non-HTML
templates; `create billing-template` always sends `templateFormat: 'HTML'`.

### Order-line-item pull unexercisable on intQA
The `list orders` filters (`--account`/`--status`) use `GET /v1/orders/subscriptionOwner/{accountKey}`,
which returns orders scoped to that account. Order-line-item (`OLI`) child traversal from those
orders works, but a standalone `pull order-line-item <id>` requires an OLI UUID. The intQA
test orders are subscription-based (OLI UUIDs not readily available without a full account
traversal), so direct OLI pull is not regularly exercised live — covered by unit tests only.

---

## Remaining work

### User roll-out feedback — product catalog pull & data-query (reported 2026-11-16)

Surfaced during roll-out from a use-case-3 (catalog) read attempt on intQA — pull the PriceVantage
product + its rate plan + charges (`cgeaa zuora pull product PriceVantage`). Three distinct gaps; fix
via the ranked path below. **All three ship via the Required development flow (top of file)** — Vitest
tests with every change, `cd zdf && npm run build && npm test` green, and live intQA **read-only**
verification (resolve + `pull product <SKU>` against the live sandbox; never write).

**Findings**
1. **`pull` has no natural-key resolution — it requires the internal Zuora ID.** `pull product PriceVantage`
   and `pull product PTL-EDG` (the SKU) both fail with `Invalid object id`; `pull product-rate-plan <id>` hits
   `GET /v1/object/product-rate-plan/{id}`, which only accepts the internal ID. This contradicts the README's
   "natural key or internal id" claim (`README-ZDF.md:813-815`) — that only holds for `push`/`delete`, which
   resolve the ID from the local `_zdf`/stored file. On a **first** `pull` there is no local file yet, so the
   internal ID is the only accepted key.
2. **Jira-recorded sandbox IDs are environment-stale.** FINT-14029's intQA rate-plan id
   `f6e6431815f9739fdcd74165f2b2047a` now 404s (`{"size":0,"records":[]}`) — intQA was refreshed since the
   2025 ticket. "Just use the ID from the ticket" can't be trusted → reinforces the need for live name/SKU → ID
   resolution (fix A). (Not itself a code change; context motivating A/B.)
3. **`create data-query` sends the wrong request body — advertised but 100% broken.**
   `src/commands/data-queries.ts:64` posts `apiPost('/query/jobs', { queryString: sql })`. Zuora's **Data
   Query API** expects `query` (not `queryString`), so every job fails `400 Unable to process JSON` — even
   `SELECT Id, SKU, Name FROM Product LIMIT 5`. The field name was copied from the **synchronous** ZOQL helper
   `apiQuery` (`src/api/client.ts:184`, `POST /v1/action/query` with `{ queryString }`) — correct for *that*
   endpoint, but the two endpoints use different schemas.

**Resolution (ranked)**
- **A. PRIMARY — teach `pull` to resolve a natural key via the ZOQL path that already works.** `apiQuery`
  (`src/api/client.ts:184`, `POST /v1/action/query`) is live, fast, and already trusted by dependency
  traversal. In the catalog pull commands (`src/commands/products.ts`, `product-rate-plans.ts`,
  `product-rate-plan-charges.ts`), before the object-GET fallback: if the arg is not a valid internal ID,
  resolve it first —
  - `pull product <key>` → `SELECT Id FROM Product WHERE SKU = '<key>' OR Name = '<key>'`
  - `pull product-rate-plan <key>` → resolve by `Name`
  - `pull product-rate-plan-charge <key>` → resolve by `Name`
  Single-quote-escape the key (reuse the escaping in `upsert.ts` `searchByKey`); 0 rows → clear not-found; >1
  rows → ambiguous error listing the candidate IDs. Makes the documented "natural key or internal id" claim
  true for `pull` and directly fixes the reported command.
- **B. Add a `list products` discovery command** (sibling to `list orders` / `list billing-templates`),
  backed by the same `apiQuery`, printing `Id / SKU / Name / EffectiveStartDate`. Gives operators a way to find
  the current ID without the Zuora UI and without trusting a stale ticket ID (Finding 2).
- **C. Fix the data-query body bug regardless of A/B** (`src/commands/data-queries.ts:64`): send the Data
  Query schema — `{ query: sql, outputFormat: 'JSON', compression: 'NONE', retries: 3 }` — and update the
  assertion in `src/__tests__/commands/data-queries.test.ts:64` (currently pins the wrong `{ queryString }`
  shape). NOTE: Data Query is **async** (returns a result-file URL the CLI does not currently download), so
  it's a poor fit for a quick ID lookup anyway — hence A/B are the better primary fixes. Still worth fixing
  since the command is advertised and currently 100% broken. (Full support later = poll the job to `completed`
  + download/parse the result file.)
- **D. Add a `--name <substr>` filter to the already-shipped `list workflows`** (minor enhancement; reported
  2026-11-16 from a workflow-pull-by-name attempt on intQA). The `list workflows` discovery command itself
  **already exists** (`src/commands/workflows.ts:263`, paginated `GET /workflows`) — the roll-out report hit
  the gap only because the installed `cgeaa` bundle predates it (**rebuild to get it**; the same stale-bundle
  cause as the data-query 404s). The one net-new ask is a client-side **case-insensitive substring filter on
  the workflow name** so an operator can run `cgeaa zuora list workflows --name "CoOp Rebate"` to find the
  current tenant workflow-definition ID, then feed it to `pull workflow <id>`. This is a *discovery filter*,
  **not** name→ID resolution — workflow verbs stay ID-only by design (names aren't guaranteed unique; see
  `CLAUDE.md` "Workflows API"). Ship via the ZDF dev flow with a unit test on the filter. (`list products`
  from fix B closes the equivalent catalog gap.)

### Open item
- **Credit/debit-memo cross-tenant create is unit + real-filesystem tested but not yet
  live-confirmed.** Reason: a live A→B run requires a subscription-billed invoice (a standalone
  invoice item has no `skuName`, which the memo item-matcher + invoice-scoped memo create both
  require). This is out of scope for throwaway intQA test data. **Risk:** low — the create body
  is a strict superset of the verified `{ items: [...] }` shape (header fields like
  `comment`/`reasonCode`/`effectiveDate` in `toMemoCreateBody` are additive; a rejected field
  would be a one-line trim).

### Roadmap

- **Default output location: prefer an existing `Zuora/zdf-output` in the FinSys/FinTech repo.**
  Today `getOutputDir()` (`src/helpers/file-io.ts`) resolves the output directory in this order:
  `ZDF_OUTPUT_DIR` env var → `zuora_output_dir` in `~/.cgeaa/config` / `.cgeaa/config` →
  `./zdf-output` relative to the current working directory. Add a smarter default **below** those two
  explicit overrides (both still win): if the repo already has a `Zuora/zdf-output` folder, send
  **all** output there; only create a brand-new `zdf-output` (in the cwd) when no `Zuora/zdf-output`
  exists. Goal: stop scattering a fresh `zdf-output` wherever the command happened to be run when the
  canonical `Zuora/zdf-output` under the repo's `Zuora/` directory already exists.
  - **Design considerations:** locate the repo's `Zuora/` folder (walk up from cwd for a `Zuora/`
    dir, or a repo-root marker) rather than assuming cwd; if `Zuora/` exists but `Zuora/zdf-output`
    does not, that's the one place it's allowed to be auto-created; if no `Zuora/` folder is found,
    fall back to today's `./zdf-output`; `ZDF_OUTPUT_DIR` and `zuora_output_dir` remain explicit
    overrides that take precedence. Ship via the ZDF dev flow with unit tests pinning the full
    resolution order.
  - **Re-reported 2026-11-16 (user roll-out):** running `cgeaa zuora` from inside the repo's `NetSuite/`
    directory created `zdf-output` **under `NetSuite/`** — exactly the cwd-scattering this item fixes. Desired
    behavior: ZDF always resolves to the repo's `FinTech/Zuora/zdf-output` (via the walk-up above) regardless
    of which subdirectory the CLI is invoked from, and reads/writes state there on every session. **Still
    pending — this is unimplemented work, NOT a stale-bundle issue** (unlike the `list workflows` report above).

- **Cross-tenant sync/upsert for `workflow` and `billing-template` via the `_zdf` id-map.**
  Extend the cross-tenant push (today scoped to account/product/invoice/credit-memo/debit-memo) to
  the two config resources, so a *single* workflow or HTML template can be promoted object-by-object
  between tenants (e.g. IntQA → StagingUAT) rather than only edited in place in one tenant.

  **Why it was deliberately left out (design decision 2026-08-19 — see
  `docs/promotion-deployment-manager.md` and CLAUDE.md "Scope & promotion"):** config *promotion*
  was assigned to Zuora's native **Deployment Manager**, and ZDF's `_zdf` cross-tenant upsert was
  limited to use-case-2 financial/test data. The `CROSS_TENANT` registry omits `workflow` and
  `billing-template` for this reason. (The earlier `sync-diff` ZDF-as-pipeline engine was removed.)

  **Why it's still worth doing — the gap Deployment Manager cannot fill:** the DM API is
  **component-type / all-or-nothing** (`workflows: true` deploys *all* workflows; no object-level
  selection), so it cannot promote one workflow or one template. ZDF already has full `workflow`
  CRUD (export/import) and three-type `billing-template` support (`_zdfTemplateType` marker), so
  object-level cross-tenant promotion is a surgical complement to DM's coarse promotion — not a
  replacement. (The promotion doc's own open follow-up also notes it's unconfirmed whether DM
  cleanly promotes billing/invoice *templates* at all.)

  **Design considerations before building:**
  - `workflow` and `billing-template` are NOT ZOQL-queryable billing objects (Workflows API /
    Settings API), so `upsert.ts` `searchByKey` (ZOQL natural-key search) does **not** apply.
    First-time cross-tenant matching (no `_zdf` entry yet) needs a **list-in-target + name match**
    (`list billing-templates`; `cgeaa zuora list workflows` — **now implemented**) — and **workflow names are not guaranteed
    unique** (`resource-registry.ts`), so the id-map is reliable for a known mapping but first-time
    workflow matching is ambiguous and may need an explicit target id / confirmation.
  - Per-tenant internal ids aren't stable cross-environment (`docs/promotion-deployment-manager.md`);
    reuse the existing accumulating `_zdf` map model.
  - Local-only state is already stripped before send (workflow posts its `/export` body;
    billing-template strips `_zdf`/`_zdfTemplateType`), so the marker discipline is in place.
  - Decide create-into-empty vs update-only per resource (workflow create = new definition via
    `POST /workflows/import`; billing-template create = `POST /settings/{type}-templates`).

  Assess against the "Scope & promotion" contract in `CLAUDE.md` before implementing — this is
  additive object-level promotion that sits alongside Deployment Manager, not a new CI/CD pipeline.
