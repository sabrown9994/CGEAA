# Plan — cross-tenant create-shape adapters + product SKU key

## Context / spec
Follow-on to the cross-tenant env-id map / upsert feature. Two gaps to close (user-approved):
- **Create-shape adapters (#2/#4):** when `push` upserts a record that does NOT exist in the active
  (target) env, the create branch currently POSTs the raw *pulled* (GET-shape) body, which the
  create API rejects (shape mismatch). Build per-resource adapters that transform the pulled record
  into the create-API body for **account, invoice, credit-memo, debit-memo**, so net-new creation
  into a lower env works. The created id is already stored in `_zdf[activeEnv]` by the existing
  upsert writeback — keep that.
- **Product SKU key (#3):** adopt `SKU` as product's natural key for file naming + cross-tenant
  search + the UPDATE path. Product net-new creation stays template-based (`zdf template product` +
  `create`) — do NOT build a Commerce create-adapter from the pulled product object.

## Global Constraints
- TS/CJS, Node16 — all internal imports use `.js`. Vitest `vi.hoisted`. `process.exit` spy pattern.
- `cd /Users/rpinto/Documents/CGEAA/zdf && npm run build` + `npx tsc --noEmit` succeed; `npm test`
  green (baseline **438** — add tests, never regress). Commit on `feature/zuora-integration`
  (no --amend/--no-verify).
- `_zdf` is NEVER sent to Zuora (stripEnvMap stays on every outbound body — the adapter output must
  also be `_zdf`-free).
- Reuse: `env-map.ts`, `upsert.ts`, `upsert-command.ts`, `file-io.ts`, `resource-registry.ts`,
  existing account/invoice/memo command body-prep + response handling. The known-good create bodies
  from prior live work are the target shapes (see Tasks).

## Design rulings (controller)
- **R1 — adapters live in a new `src/helpers/create-shape.ts`** (pure functions, unit-tested):
  `toAccountCreateBody(pulled)`, `toInvoiceCreateBody(pulled)`, and the memo create body stays the
  `{ items: matchInvoiceItems(...) }` shape (already built) — factor it if it helps, else leave.
- **R2 — adapters preserve the natural key** (account keeps its accountNumber; invoice keeps
  invoiceNumber if the create API accepts it, else omit) so a subsequent push finds the created
  record by key. Drop read-only/rejected fields (ids, status, metrics, contact ids).
- **R3 — product:** add to `NATURAL_KEY` (SKU); make `delete product` resolve the target id from the
  local file (`_zdf[activeEnv].id` or the record's `Id`) rather than the CLI arg, since SKU is not a
  valid key for `/v1/object/product/{id}`. `push product` already resolves via `resolveTargetId`.
- **R4 — verification:** live A→B (intQA↔StagingUAT) is available; the create-into-empty path IS now
  live-verifiable. Use throwaway data, clean up in BOTH tenants.

## Tasks

### Task 1 — create-shape adapters for account + invoice (+ wire into push create branch)
NEW `src/helpers/create-shape.ts`:
- `toAccountCreateBody(pulled)` → the flat account-create body: `{ accountNumber (from
  basicInfo.accountNumber), name (basicInfo.name), currency (basicInfo.currency or
  billingAndPayment.currency), billCycleDay (billingAndPayment.billCycleDay), autoPay
  (billingAndPayment.autoPay ?? false), billToContact {firstName,lastName,country,state,...
  from pulled billToContact, dropping id/accountId/contactDescription}, soldToContact {same},
  invoiceCollect:false }`. Drop everything read-only (id, status, metrics, etc.). Include only
  fields the create API accepts (mirror the known-good create body used in prior live tests).
- `toInvoiceCreateBody(pulled)` → the flat invoice-create body `{ accountNumber, invoiceDate,
  invoiceItems: [ per item: amount, serviceStartDate, serviceEndDate (yyyy-MM-dd HH:mm:ss),
  chargeName, the 9 accounting codes, revenueRecognitionRuleName ] }` sourced from the pulled
  invoice + its embedded `invoiceItems`, dropping ids/read-only. (The accountNumber FK remap
  already runs before this in the command — keep that order.)
Wire into the push CREATE branch of accounts.ts and invoices.ts: when `resolveTargetId` returns
not-found, POST `stripEnvMap(toXCreateBody(fileRecord))` instead of the raw body. Keep the created
id → `_zdf[activeEnv]` writeback + stale-source cleanup exactly as now. Unit tests: given a pulled
fixture, the adapter emits the expected create body (no read-only/`_zdf` fields; correct field
paths). Keep the standalone `create <resource> <name>` path (explicit create from a create-shaped
or template file) unchanged.

### Task 2 — product SKU natural key + delete-by-resolved-id
- `resource-registry.ts`: add `product: (r) => str(r['SKU'] ?? r['sku'])` to `NATURAL_KEY`.
- `products.ts` `delete product <arg>`: resolve the target id from the local file — read the file
  (readResourceFileByIdOrName), take `_zdf[activeEnv].id` if present else the record's `Id`/`id`,
  and `DELETE /v1/object/product/{resolvedId}` (NOT the arg). If no local file/id resolvable, fall
  back to treating the arg as the id (back-compat). Keep push (already resolves via resolveTargetId).
- Confirm pull now writes `products/<SKU>.json`; `push`/`delete` by SKU or by id both work (readResourceFile findByStoredId covers id→file).
Tests: product file named by SKU; delete resolves the id from `_zdf`/body, not the SKU arg; push
still uses the resolved id; existing product tests adjusted.

## Verification (per task + final + live)
Each task: build + tsc + tests green. Final: whole-branch review. Then CONTROLLER runs a
comprehensive live A→B test (intQA→StagingUAT) across account, invoice, credit-memo, debit-memo
(create-into-empty via adapter + update + idempotent re-push), product (update/search by SKU), and
bill-run (map-only) — throwaway data, cleaned up in both tenants.
