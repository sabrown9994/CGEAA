# ZDF — Push side: add missing create/delete actions + full create→push→delete validation

## Context
The pull side of ZDF is fully validated live against intQA. Now we validate the WRITE side. Six
resources lack a `create` action (product-rate-plan-charge, billing-template, invoice, credit-memo,
debit-memo, bill-run). The user wants: (1) add create for all six + add delete wherever Zuora
supports it; (2) update TODO.md + README.md; (3) live-test the full create→push→delete cycle for
ALL resources — create a test record, confirm it exists (pull), push an update, delete it, confirm
deletion. Auto-create the full prerequisite chain where a create isn't self-contained. Everything is
marked `TEST ZDF POC`. **Never touch a record not created by us or not explicitly named by the user.**

Endpoint research is in `.superpowers/sdd/2026-08-06-zdf-push-side/endpoints.md` (summarized below).

## Global Constraints
- Branch `feature/zuora-integration`. Node16 `.js` imports. Vitest `vi.hoisted` mocks. Every code
  change ships with tests; `cd zdf && npm run build` and `npm test` must pass (baseline 203).
- **Live writes are authorized ONLY for records we create (marked `TEST ZDF POC`) or ids the user
  explicitly provides.** Never modify/delete pre-existing tenant data. Reference ids the user has
  already authorized: billing-template `8a8aa02e9fd1baf0019fd2ea46473db6`; product
  `8a8aa3e39fd5d653019fd77465614d1e` (rate-plan `f6e6f40d5f59fd5bd0dfd77819f10092`).
- Live output → a temp dir via `ZDF_OUTPUT_DIR` (e.g. `/tmp/zdf-poc-test`), never the repo.
- Match the existing create/delete command pattern (see `src/commands/products.ts`): `createCmd`
  under the shared `create` verb, `POST` to the create endpoint, `assertSuccess`, rename local file
  to the returned id; `deleteCmd` under `delete`, `DELETE` endpoint, `assertSuccess`,
  `resolveAndSync(..., 'delete')` to clean local files.
- ZDF-only (`zdf/src`, `zdf/README.md`, `zdf/TODO.md`, `zdf/docs`). Do not touch the SF/bash side.

## Endpoints (from research; confidence noted)
| resource | create | delete | prereq | confidence |
|---|---|---|---|---|
| product-rate-plan-charge | `POST /v1/object/product-rate-plan-charge` (PascalCase body, `ProductRatePlanId` + charge fields) | `DELETE /v1/object/product-rate-plan-charge/{id}` | parent rate-plan | medium |
| billing-template | `POST /settings/invoice-templates` (body: name + base64EncodedTemplateFileContent, HTML) | `DELETE /settings/invoice-templates/{id}` | none | HIGH (live-confirmed) |
| invoice | `POST /v1/invoices` (accountId + invoiceDate + invoiceItems) | `DELETE /v1/invoices/{id}` (exists, async) | account w/ charges; "standalone invoice" permission | medium |
| credit-memo | `POST /v1/credit-memos/invoice/{invoiceKey}` (from invoice) or `POST /v1/credit-memos` (from charge) | `DELETE /v1/credit-memos/{id}` (exists) | source invoice; Invoice Settlement feature | medium |
| debit-memo | `POST /v1/debit-memos/invoice/{invoiceKey}` or `POST /v1/debit-memos` | `DELETE /v1/debit-memos/{id}` (exists) | source invoice; Invoice Settlement feature | medium |
| bill-run | `POST /v1/bill-runs` (billRunFilters/batches) | `DELETE /v1/bill-runs/{id}` (exists) | account id; **generates real invoices** | high endpoint |

## Tasks

### Task 1 — create + delete for product-rate-plan-charge (catalog, self-contained)
`src/commands/product-rate-plan-charges.ts`: add `create product-rate-plan-charge <name>` →
`POST /v1/object/product-rate-plan-charge` (PascalCase body from the local file; response
`{Id,Success,Errors?}` — use the PascalCase success check like products.ts push does, or assertSuccess
adapted). Add `delete product-rate-plan-charge <id>` → `DELETE /v1/object/product-rate-plan-charge/{id}`.
Tests: create posts to the object endpoint + renames file to returned Id; delete hits the object
endpoint; PascalCase success/error handling.

### Task 2 — create + delete for billing-template (Settings API, HIGH confidence)
`src/commands/billing-templates.ts`: add `create billing-template <name>` →
`POST /settings/invoice-templates` with body {name, base64EncodedTemplateFileContent (from the local
decoded JSON, re-encoded), templateFormat:'HTML', + the allowlist optional fields}. HTML-only, same
base64 handling as pull/push. Add `delete billing-template <id>` → `DELETE /settings/invoice-templates/{id}`.
Response has no `success` envelope → use `assertReadSuccess`. Tests: create re-encodes + POSTs;
delete hits the id endpoint; non-HTML rejected on create.

### Task 3 — create for invoice, credit-memo, debit-memo, bill-run (financial docs)
Add create actions:
- invoice: `POST /v1/invoices` (`src/commands/invoices.ts`).
- credit-memo: `POST /v1/credit-memos/invoice/{invoiceKey}` primary (from a source invoice), body from
  local file; document the `POST /v1/credit-memos` charge-based alt in the report (`credit-memos.ts`).
- debit-memo: same shape as credit-memo (`debit-memos.ts`).
- bill-run: `POST /v1/bill-runs` (`bill-runs.ts`). Add a clear `output.warn` before POST that this
  executes billing / generates real invoices. bill-run has no PUT (push re-fetches) — leave push as-is.
Each: assertSuccess, rename local file to returned id, standard pattern. These depend on tenant
features (Invoice Settlement / standalone-invoice permission) that may be OFF on intQA — the CODE must
be correct regardless; live-testing will reveal gating. Tests: each create POSTs to the right endpoint
with the file body; bill-run create emits the side-effect warning.

### Task 4 — docs: TODO.md + README.md
Update `zdf/TODO.md`: mark the create/delete additions done; note per-resource cycle capability and
any tenant-gating caveats. Update `zdf/README.md`: create/delete sections + per-resource Resource
Reference rows for the new create/delete endpoints; note bill-run side effects, subscription
delete-blocked, and Invoice-Settlement/standalone-invoice gating for the financial-doc creates.
Update the Resource-coverage matrix.

## Live create→push→delete cycle validation (adversarial, after code is in)
For EACH resource, run the applicable cycle live against intQA, auto-creating prerequisite chains,
everything marked `TEST ZDF POC`:
- **Self-contained / catalog:** product (create→push→delete), product-rate-plan, product-rate-plan-charge,
  billing-template (create→push→delete; delete only the one WE create, NOT the user's ref template).
- **Chain-created:** account → contact → product → product-rate-plan → product-rate-plan-charge →
  subscription → invoice → credit-memo/debit-memo → bill-run. Create the chain top-down, test each
  resource's push, then tear down bottom-up via delete.
- **Cycle gaps (record as by-design N/A, don't force):** subscription delete is BLOCKED (cancel via
  Orders API); bill-run has no PUT (push=re-fetch); if a tenant feature gate blocks a financial create
  (invoice/credit-memo/debit-memo), record it as BLOCKED-BY-TENANT with the exact API error rather
  than a code defect.
- Confirm existence after create (pull returns the real object), confirm deletion after delete (pull
  now fails / returns not-found). Only ever delete records WE created.

## Verification (whole-branch)
1. `cd zdf && npm run build` + `npm test` green (well above 203).
2. Live cycle report: per-resource create/push/delete PASS / N/A / BLOCKED-BY-TENANT with evidence.
3. No pre-existing tenant record modified or deleted — every created id is `TEST ZDF POC` and every
   delete targets only a WE-created id. List all created ids in the report (and any left undeleted).
4. Pull side not regressed (spot-check a couple pulls).
