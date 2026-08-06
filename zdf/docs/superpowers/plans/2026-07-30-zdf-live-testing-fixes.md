# ZDF — Fix issues found during live `pull` testing (intQA)

## Context

Another agent exercised all 15 `pull` resource types against the live intQA Zuora
sandbox (2026-07-29) and logged findings in `zdf/TODO.md`. Several are correctness bugs
that cause **silent data loss or silent failure** — the most dangerous class, because a
`✔ success` prints while an error body or an empty item list is written to disk. This plan
resolves the fixable issues and uses live discovery for the genuinely-unknown ones.

All work happens on branch `feature/zuora-integration` (where all ZDF code lives), building
the local `zdf/dist` and running it directly. Auth comes from `~/.zdf/config.json` with
**intQA** active (`rest.test.zuora.com`). All live testing writes to `/tmp/zdf-fix-test`
via `ZDF_OUTPUT_DIR` — never the repo, never a shared folder.

## Global Constraints

- **Node16 module resolution**: every internal import uses a `.js` extension even for `.ts`
  source. New imports must follow this.
- **Test framework**: Vitest. All mock variables use `vi.hoisted(() => vi.fn())`. The
  `process.exit` test pattern is in `zdf/CLAUDE.md`. Every code change ships with tests.
- **Build/verify**: `cd zdf && npm run build` must succeed; `npm test` must pass, before any
  task is considered done.
- **No live writes to Zuora**: all live verification is **read-only** (`pull`/`list`/`auth`).
  Do NOT exercise `create`/`push`/`delete` against intQA. The TODO confirms all pull-family
  GETs are read-only; keep it that way.
- **Live output isolation**: every live run sets `ZDF_OUTPUT_DIR=/tmp/zdf-fix-test`.
- **Preserve existing behavior**: resources that pull correctly today (account, contact,
  subscription, product, product-rate-plan, product-rate-plan-charge, order, invoice,
  bill-run, data-query) must keep working. Don't regress the passing set.
- **Do not touch** the Salesforce/bash side of CGEAA. This plan is ZDF-only (`zdf/src`).

## Tasks

### Task 1 — P0: Stop writing Zuora error bodies to disk as "success"

**Files:** `src/api/client.ts`, `src/helpers/zuora-response.ts`, `src/helpers/dependency-graph.ts`,
`src/commands/workflows.ts`, `src/commands/billing-templates.ts`

Zuora's REST API returns **HTTP 200 with `{ success: false, reasons: [...] }`** for bad
endpoints/requests. `request()` in `client.ts` only throws on non-2xx HTTP status, so these
200-with-error bodies flow through and get written to disk while `✔` prints.

- Add a read-response guard. Preferred: a helper in `zuora-response.ts`, e.g.
  `assertReadSuccess(body, label)`, that throws when the body has `success === false`
  OR a non-empty `reasons`/`errors` array.
- **Critical nuance (from P0-2):** a *valid* response may have **no `success` field at all**
  (e.g. the workflow object). The guard must treat "no `success` field AND no
  `reasons`/`errors`" as OK. Only an explicit `success:false` or a populated error array is a
  failure.
- Apply the guard on the read path: `fetchAndWrite` in `dependency-graph.ts` (before
  `writeResourceFile`), and the direct `apiGet` calls in `workflows.ts` and
  `billing-templates.ts` pull actions. Do not write the file when the body signals failure;
  surface the Zuora error message and exit non-zero (via the existing `runCommand` error path).
- Add unit tests: (a) 200-with-`reasons` throws and writes nothing; (b) 200-with-`success:false`
  throws; (c) a body with no `success` field and no errors passes; (d) a normal
  `success:true` body passes.

### Task 2 — P0: Fix the `workflow` endpoint

**Files:** `src/commands/workflows.ts`

`ENDPOINT` is `/v1/api/workflows`, which returns `50000040 ...does not exist`. Live probe
confirms the correct path is `/workflows` (`/workflows/{id}` returns the object;
`/workflows/{id}/versions` returns versions).

- Change `ENDPOINT` to `/workflows`.
- The good GET response is the workflow object with **no `success` field** — ensure the
  Task 1 read-guard passes it (this is why Task 1 must not require `success:true`).
- Re-verify the create/push/delete paths compile and use the corrected base path. Do NOT
  live-test writes (Global Constraint). Note in the report any create/push/delete shape
  concerns for follow-up.
- Update tests in `src/__tests__/commands/` for the new endpoint.

### Task 3 — P1: Fix credit-memo / debit-memo item-key mismatch (silent data loss)

**Files:** `src/helpers/dependency-graph.ts`

`fetchAllItems` reads sub-items under `creditMemoItems` / `debitMemoItems`, but the live
`/v1/credit-memos/{id}/items` and `/v1/debit-memos/{id}/items` endpoints return the array
under **`items`**. Result: memos with 20 and 1 items embedded **0**.

- Change the `itemsKey` for credit-memo and debit-memo to `items`.
- Confirm invoice still works: `/v1/invoices/{id}/items` returns `invoiceItems` today — keep
  it correct (verify live). Normalizing all three to read `items` is acceptable ONLY if the
  invoice endpoint also returns `items`; verify before changing invoice.
- Add/adjust unit tests asserting items are captured under the corrected key.

### Task 4 — P2: Fix hardcoded `zdf-output/...` in success messages

**Files:** `src/commands/accounts.ts`, `src/commands/orders.ts`, `src/commands/workflows.ts`,
`src/commands/billing-templates.ts` (and any other pull command with a hardcoded path string)

When `ZDF_OUTPUT_DIR` is set, files write to the override but the success message still says
`zdf-output/...`. Use `resolveFilePath` (already exported from `file-io.ts:65`) to print the
actual path.

- Replace hardcoded `zdf-output/<sub>/<id>.json` strings with `resolveFilePath(resource, id)`.
- Grep the whole `src/commands` tree for `zdf-output/` to catch every instance.
- Add a test (or extend one) asserting the message reflects `ZDF_OUTPUT_DIR` when set.

### Task 5 — P1: Bound `apiQuery` / traversal so a full pull can't explode

**Files:** `src/api/client.ts`, `src/helpers/dependency-graph.ts`

`apiQuery` follows `queryMore` until `done` with no cap; ZOQL `LIMIT` is not honored by
`/v1/action/query` (a `LIMIT 3` returned 8610 rows). Combined with the account→invoice→
bill-run→invoice traversal, a dependency pull can issue thousands of serial GETs.

- Add a hard row cap to `apiQuery` (a named constant, e.g. `APIQUERY_MAX_ROWS`) that stops
  paginating and emits a `output.warn` when truncated — never silently.
- Add a traversal ceiling in the dependency graph: cap total visited nodes (a named
  constant) and warn when hit, so a runaway `pull account` degrades gracefully instead of
  hanging. `--no-dependency` already bypasses traversal; keep that path unchanged.
- Do NOT change default correctness for small accounts — caps must be high enough that normal
  pulls are unaffected, and must warn (not error) when exceeded.
- Unit tests: `apiQuery` stops at the cap and warns; traversal stops at the ceiling and warns.

### Task 6 — P1: Make `list orders` bounded and filterable

**Files:** `src/commands/orders.ts`

`list orders` paginates ALL orders (pageSize 50) and issues a GET per line item — wrote 3900+
files on intQA before being killed.

- Add a `--limit <n>` option that stops after N orders.
- Add at least one filter option (e.g. `--account <id>` using `/v1/orders?accountId=`, and/or
  `--status`); wire it into the query string.
- Keep the unfiltered full-export behavior available but make it explicit (e.g. require
  `--all` or print a clear warning of full-tenant scope before starting).
- Unit tests for `--limit` (stops early) and the filter (adds the right query param).

## Adversarial live verification (dedicated tester)

After the implementation tasks, a dedicated **adversarial tester** agent verifies every fix
against **live intQA**, starting from the assumption that each fix is wrong and trying to
break it. Read-only only. Writes to `/tmp/zdf-fix-test`. It must:

- Rebuild `zdf/dist` from the branch and run `node zdf/dist/zdf.js ...` (not the global install).
- For P0-1: `pull workflow 1` and `pull billing-template 1` must now **fail loudly** (non-zero
  exit, error surfaced) and write **no** file — grep `/tmp/zdf-fix-test` to confirm absence.
- For P0-2: find a real workflow id via `GET /workflows` (list) and `pull workflow <realId>` —
  must write a real workflow object, not an error body.
- For P1-1: find a credit-memo and debit-memo with items (via `?accountId=`), pull them, and
  assert the written file embeds the correct non-zero item count under the fixed key.
- For P1-2 / P1-3: confirm caps/limits actually stop traversal and `list orders --limit 5`
  writes exactly 5, with warnings when truncated.
- For P2-3: run with `ZDF_OUTPUT_DIR=/tmp/zdf-fix-test` and confirm success messages print the
  real path.
- **Live discovery for the unknowns (P0-3, P2-1, P2-2):** probe intQA to (a) find any working
  billing-template endpoint, (b) confirm which ZOQL in `dependency-graph.ts` the tenant
  actually accepts, (c) locate an order with real order-line-items if one exists. Report
  findings; do NOT blind-fix billing-template.

The tester writes a findings report; any confirmed breakage re-enters the fix loop.

## Open items requiring judgment (surfaced, not blindly fixed)

- **P0-3 billing-template endpoint**: correct path is unknown and may not exist as a REST
  resource in this tenant. Discovery-only this pass; if no endpoint is found, recommend
  documenting the limitation or removing the resource — do not guess an endpoint.
- **P2-1 ZOQL audit**: some standard objects reject fields via `/v1/action/query`. Audit only;
  fix a specific query only if the tester proves the tenant rejects it AND a REST alternative
  exists (the `?accountId=` endpoints already used elsewhere).
- **P2-2 order-line-item pull**: intQA orders are subscription-based (no OLIs). If the tester
  finds no order with OLIs, this stays untested and is noted as a coverage gap, not a fix.

## Verification (whole-branch)

1. `cd zdf && npm run build` succeeds.
2. `cd zdf && npm test` — all tests pass.
3. Adversarial tester's live report against intQA shows: P0-1 fails loudly with no file
   written; P0-2 pulls a real workflow; P1-1 embeds correct item counts; P1-2/P1-3 caps
   enforced; P2-3 paths correct.
4. Passing resource set (account, contact, subscription, product family, order, invoice,
   bill-run, data-query) still pulls correctly — no regression.
