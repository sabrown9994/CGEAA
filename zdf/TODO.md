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

### Open item
- **Credit/debit-memo cross-tenant create is unit + real-filesystem tested but not yet
  live-confirmed.** Reason: a live A→B run requires a subscription-billed invoice (a standalone
  invoice item has no `skuName`, which the memo item-matcher + invoice-scoped memo create both
  require). This is out of scope for throwaway intQA test data. **Risk:** low — the create body
  is a strict superset of the verified `{ items: [...] }` shape (header fields like
  `comment`/`reasonCode`/`effectiveDate` in `toMemoCreateBody` are additive; a rejected field
  would be a one-line trim).

### Roadmap

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
    (`list billing-templates`; a workflow listing) — and **workflow names are not guaranteed
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
