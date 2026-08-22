# Plan — ZDF cross-tenant env-id map + upsert

## Context / spec

ZDF (`/Users/rpinto/Documents/CGEAA/zdf`) should let a developer move a resource between Zuora
tenants (e.g. pull from prod, push into a lower env) even though Zuora internal ids differ per
tenant. Approach (agreed with the product owner across prior design turns):

- Each resource's local JSON file carries an env-id map, `_zdf`, keyed by the ACTIVE auth env
  **name**, each value `{ id, key }` (the resource's internal id and natural key in that env).
- `_zdf` is stored ONLY in the local file and is ALWAYS stripped before any body is sent to Zuora.
- `pull` populates `_zdf[activeEnv]` from the fetched record.
- `push`/`create` UPSERT: resolve the active env's id via the map, then verify-then-fallback:
  1. If `_zdf[active].id` exists → `GET` it; if it resolves, UPDATE it.
  2. Else search the active tenant by the resource's natural key; if found → adopt id (+key) and
     UPDATE; if not found → CREATE, then store the returned id+key.
  3. If CREATE fails "already exists" → search by key, adopt, UPDATE.
- Foreign-key references in the body are remapped to active-env values before create/update.
- Files are already natural-key-named (prior work); the filename is a stable local handle.

**Scope (6 resources):** account, product, invoice, credit-memo, debit-memo (upsert); bill-run
(pull → id-map ONLY, no cross-tenant create/push — create runs real billing).

## Global Constraints

- TypeScript, CJS, Node16 module resolution: **all internal imports use the `.js` extension**.
- Vitest with `vi.hoisted(() => vi.fn())` for mock vars; the `process.exit` spy pattern for exits.
- `cd /Users/rpinto/Documents/CGEAA/zdf && npm run build` and `npx tsc --noEmit` must succeed;
  `npm test` must stay green (baseline **306** — add tests, never regress).
- `_zdf` must NEVER be sent to Zuora. Every create/push/update body passes through the strip helper.
- Commit on `feature/zuora-integration` (no `--amend`, no `--no-verify`). One task = one focused commit set.
- Reuse existing helpers: `apiGet/apiPost/apiPut/apiDelete/apiQuery` (`src/api/client.ts`),
  `readResourceFile/writeResourceFile/writeResourceFileAs/resolveFilePath/getOutputDir`
  (`src/helpers/file-io.ts`), `runCommand` (`src/helpers/command-runner.ts`),
  `output` (`src/helpers/output.ts`), `assertSuccess/assertReadSuccess` (`src/helpers/zuora-response.ts`),
  `NATURAL_KEY/hasNaturalKey/recordId/sanitizeForFilename` (`src/helpers/resource-registry.ts`).
- The natural-key file naming and the `findByStoredId` fallback (already shipped) stay as-is; this
  feature layers the `_zdf` map on top. The authoritative per-env id for a WRITE is `_zdf[active].id`
  (resolved via verify/search/create), NOT the record's top-level id field.

## Design rulings (controller, pre-flight)

- **R1 — filename is a local handle.** The file keeps its natural-key filename from whatever env it
  was first pulled from; `_zdf` is the per-env source of truth. No re-naming per env.
- **R2 — FK remap for invoice.** `invoice` create/push resolves its `accountNumber` FK by reading the
  sibling local **account** file (located by the body's source `accountNumber`, via readResourceFile
  → findByStoredId) and substituting that account's `_zdf[active].key`. If the account isn't mapped in
  the active env, error clearly: "seed/pull the account into <env> first".
- **R3 — memo item-matching.** `credit-/debit-memo` create resolves the target invoice via the source
  invoice's local file → `_zdf[active].id`, GETs that invoice's items, and matches each memo item's
  source `invoiceItemId` to a target item by (`skuName` + `amount`) to get the target `invoiceItemId`.
- **R4 — env name = `getActiveEnv().name`** is the `_zdf` slot key (no hardcoded env enum).
- **R5 — verification.** Only intQA is configured; true A→B is not live-verifiable. Verify mechanics
  against intQA (self-contained create-then-delete; a two-env-names-same-tenant simulation to exercise
  verify/search/adopt) and unit-test FK-remap + item-matching. Note the two-tenant gap in docs.

## Tasks

### Task 1 — env-map helper + cross-tenant registry config (pure, unit-tested)
NEW `src/helpers/env-map.ts`:
- `ENV_MAP_KEY = '_zdf'`; types `EnvEntry { id: string|null; key: string|null }`, `EnvMap = Record<string,EnvEntry>`.
- `activeEnvName(): string` → `getActiveEnv().name`.
- `stripEnvMap<T>(body: T): T` → shallow clone without `_zdf` (no-op for non-objects/arrays).
- `getEnvEntry(record, envName): EnvEntry | undefined`.
- `setEnvEntry(record, envName, entry: Partial<EnvEntry>): record` → merges, preserves other envs.
Extend `src/helpers/resource-registry.ts` with `CROSS_TENANT: Record<string, { zoqlObject: string;
zoqlKeyField: string; upsertable: boolean }>` for the 6 resources (account/Account/AccountNumber,
product/Product/SKU, invoice/Invoice/InvoiceNumber, credit-memo/CreditMemo/MemoNumber,
debit-memo/DebitMemo/MemoNumber [upsertable:true]; bill-run/BillRun/BillRunNumber [upsertable:false]).
Unit tests for env-map (strip/get/set round-trips, other-env preservation) and CROSS_TENANT presence.

### Task 2 — upsert resolver (helper, mocked unit tests)
NEW `src/helpers/upsert.ts`: `resolveTargetId(resource, record): Promise<{ id: string; created: boolean }>`
implementing verify-then-fallback using CROSS_TENANT + env-map:
- read `_zdf[active].id`; if set, `apiGet` verify (resource's GET endpoint) → if ok return {id, created:false}.
- else `apiQuery('SELECT Id FROM <zoqlObject> WHERE <zoqlKeyField> = \'<key>\'')` → if 1 row, return that id.
- else return a sentinel meaning "not found → caller must create".
Plus `searchByKey(resource, key): Promise<string|undefined>` and `naturalKeyValue(resource, record)`.
No writes here; pure resolution + search. Mocked unit tests for all three branches.

### Task 3 — pull populates `_zdf[active]` (6 resources)
In the pull path, after a successful fetch, set `_zdf[active] = { id: recordId(record), key:
naturalKeyValue(resource, record) }` before writing. Do this centrally where records are written for
these resources (dependency-graph `fetchAndWrite` for the graph resources; the command for product).
Ensure it does NOT break natural-key filename derivation (the `_zdf` block must be ignored by
`fileNameFor`). Tests: a pulled file gains a correct `_zdf[<env>]` entry; `_zdf` never reaches Zuora.

### Task 4 — account & product upsert (create/push), self-contained live verify
Rewire `create`/`push` for account and product to: read file → `stripEnvMap` → `resolveTargetId` →
if found UPDATE (PUT for account; `/v1/object/product` for product), else CREATE → store `_zdf[active]`
→ write file back. account has no FK to remap; product is self-contained (Commerce). Mocked command
tests for both branches (found→update, not-found→create, map stored). Controller runs a self-contained
intQA verification (create throwaway → confirm `_zdf` populated → re-push finds+updates → delete).

### Task 5 — invoice upsert with account FK remap (R2), live verify
As Task 4 for invoice, plus: before create/update, remap `accountNumber` to the sibling account
file's `_zdf[active].key` (error if unmapped). Mocked tests incl. the FK remap and the unmapped-account
error. Self-contained live verify against intQA.

### Task 6 — credit-/debit-memo upsert with item-matching (R3), live verify
As Task 4 for memos, plus item-matching: resolve target invoice via the source invoice file's
`_zdf[active].id`, GET its items, match by skuName+amount to fill target `invoiceItemId` per memo item;
error clearly if the source invoice isn't mapped or an item can't be matched. Mocked tests for the
matcher and error paths. Self-contained live verify (account→posted invoice→memo, upsert, teardown).

### Task 7 — bill-run pull id-map only + docs
bill-run: pull populates `_zdf[active]` (already via Task 3 if wired for all 6) but create/push stay
NON-upsert (unchanged; create still warns real-billing). Confirm bill-run is excluded from the upsert
wiring. Update README-ZDF.md (new "Cross-tenant (env-id map / upsert)" section), CLAUDE.md, and TODO.md.
Note the two-tenant verification gap (R5).

## Verification (per task + final)
Every task: `npm run build`, `npx tsc --noEmit`, `npm test` green. Tasks 4-6 add a self-contained
intQA live check (throwaway create-then-delete; all test data cleaned up). Final: whole-branch review.
