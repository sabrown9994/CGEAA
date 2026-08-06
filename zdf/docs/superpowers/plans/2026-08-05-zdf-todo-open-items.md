# ZDF — Implement the open TODO items

## Context

`zdf/TODO.md` lists open feature items after the 2026-07-30 bug-fix pass. This plan implements
them using the required multi-agent dev flow (see below), with an enhanced 4-role agent loop
the user specified. All work is on branch `feature/zuora-integration`. Live testing is against
the intQA Zuora sandbox (`rest.test.zuora.com`, active env in `~/.zdf/config.json`).

**Write authorization for this run (explicit, narrow — normally intQA is read-only):**
- Item #1 `update` (PUT): ONLY template `8a8aa02e9fd1baf0019fd2ea46473db6` ("HTML - ZDF POC")
  may be PUT. No other template may be written.
- Item #3 create-order: order creation is allowed ONLY if the order name includes the literal
  string `TEST ZDF POC`. Existing OLI order `O-01339581` may be pulled for verification.
- Everything else stays read-only (`pull`/`list`/`auth`).

**Live facts already verified read-only (2026-08-05) — build on these, don't re-derive:**
- Template `8a8aa02e9fd1baf0019fd2ea46473db6` is HTML format; its
  `base64EncodedTemplateFileContent` decodes to JSON (`{"design":{...}}`), 431819 bytes.
- `GET /settings/invoice-templates` → 200, list of 34 (metadata only, no content).
- `GET /settings/invoice-templates/{id}` → 200, metadata + `base64EncodedTemplateFileContent`.
- Order `O-01339581` has **2** orderLineItems; first OLI id
  `8a8aa2a29fd1d135019fd2edee8f324b`; order's account `ACG00026522`.
- `GET /v1/orders/subscriptionOwner/{accountKey}` → 200, shape `{orders:[...], success}`, and
  it genuinely scopes per account (`ACG00018042`→3, `ADM-00033408`→3, `ACG00026522`→0). This is
  the fix for the `accountId`-ignored problem.

## Global Constraints

- **Branch:** all commits on `feature/zuora-integration` only.
- **Node16 module resolution:** internal imports use `.js` extension even for `.ts` source.
- **Tests:** Vitest; all mock vars via `vi.hoisted(() => vi.fn())`; process.exit test pattern per
  `zdf/CLAUDE.md`. Every code change ships with tests. `cd zdf && npm run build` and
  `npm test` must pass before a task is done. Current baseline: 127 tests.
- **Live testing:** intQA only. Read-only (`pull`/`list`/`auth`) EXCEPT the two narrow write
  authorizations above. Every live invocation sets `ZDF_OUTPUT_DIR` to a temp dir
  (`/tmp/zdf-poc-test`), never the repo/shared folders; clean up after.
- **Don't regress** the passing resource set or the three existing caps.
- **ZDF-only:** do not touch the Salesforce/bash side of CGEAA.
- **Settings API is NOT `/v1/`-prefixed:** invoice-template endpoints live at
  `/settings/invoice-templates`.

## Tasks

### Task A — item #4: CLI cap flags + `--no-caps` + progress indicator
**Files:** `bin/zdf.ts` (global options), `src/api/client.ts`, `src/helpers/dependency-graph.ts`,
`src/helpers/output.ts` (or a new progress helper), command files as needed.
- Add global CLI options `--max-rows <n>`, `--max-nodes <n>`, `--max-items <n>` overriding
  `APIQUERY_MAX_ROWS` / `MAX_TRAVERSAL_NODES` / `FETCH_ALL_ITEMS_MAX` for one invocation. Plumb
  them the same way `--debug` and `--no-dependency` are wired (a setter per module, called from
  the global option hook in `bin/zdf.ts`). Keep the constants as defaults.
- Add `--no-caps` (alias `--unbounded`) that disables all three caps; print a clear `output.warn`
  that the run may be long / enumerate whole tables.
- Add a progress/status indicator for long pulls (spinner or status line showing current
  resource, page number, running record count). `ora` is already a dependency. MUST degrade
  gracefully in non-TTY / piped output (no ANSI garbage) and not clobber existing `output.*`
  lines. Do not spin during unit tests (guard on TTY / an env flag).
- Tests: flags override the caps (assert the setter receives the parsed int); `--no-caps`
  disables enforcement (pagination/traversal do not stop at the default limit); progress helper
  no-ops in non-TTY.

### Task B — item #2: orders account filtering via `subscriptionOwner`
**Files:** `src/commands/orders.ts`, `src/helpers/dependency-graph.ts`.
- `list orders --account <accountKey>` must use `GET /v1/orders/subscriptionOwner/{accountKey}`
  (response `{orders:[...], success}`), NOT `/v1/orders?accountId=` (which the tenant ignores).
  Preserve `--limit`, `--status`, `--all`, and the no-flags guard (throws → exit 1).
- In `dependency-graph.ts` `rulesAccount`, switch the account→orders traversal from
  `fetchAllItems('/v1/orders?accountId=${id}', 'orders')` to the subscriptionOwner endpoint so a
  dependency pull scopes to the account. Keep it bounded by `FETCH_ALL_ITEMS_MAX`. NOTE: the
  account id used in traversal is the internal id; subscriptionOwner takes an account
  number/key — resolve the correct key (the account record has `accountNumber`/`basicInfo`;
  confirm which value the endpoint accepts; `ACG…`/`ADM…` numbers worked live).
- Tests: `--account` hits the subscriptionOwner URL with the right key; traversal uses it;
  `--status`/`--limit` still compose.

### Task C — auth: reactive 401 refresh + single retry
**Files:** `src/auth/token.ts`, `src/api/client.ts`.
- `ensureToken` currently refreshes only on expiry timestamp. Add the ability to FORCE a refresh
  (e.g. a `force` param, or clearing the cached token) that bypasses the expiry check.
- In `request()` (`client.ts`), on an HTTP **401**, force a token refresh and replay the request
  **exactly once**; if it still 401s, surface the error. One retry only — no loops.
- Tests: a 401-then-200 sequence triggers exactly one refresh + one replay and succeeds; a
  persistent 401 refreshes once then throws (assert call counts).

### Task D — item #1: billing-template HTML get / list / update
**Files:** `src/commands/billing-templates.ts` (rewrite the endpoint + behavior), tests.
- Endpoints (Settings API root): list `GET /settings/invoice-templates`; get
  `GET /settings/invoice-templates/{id}`; update `PUT /settings/invoice-templates/{id}`.
- **`pull billing-template <id>`:** fetch the template; if `templateFormat !== 'HTML'`, error out
  clearly (HTML-only feature). Base64-decode `base64EncodedTemplateFileContent` and write the
  decoded JSON (pretty-printed) as the file BODY — not the metadata wrapper. Filename
  `<name>_<id>.json` in `billing-templates/`, using the EXISTING `file-io.ts` `sanitizeSegment`
  unchanged (lossy name is fine; `id` is the authoritative key). Confirm the decoded content is
  valid JSON before writing; if not, error (don't write a broken file).
- **`list billing-templates`:** `GET /settings/invoice-templates`, print metadata (id, name,
  templateNumber, templateFormat). Register under the existing `list` command group.
- **`update billing-template <id>` (a.k.a. push):** read the `<name>_<id>.json` (accept the id as
  the argument; locate the file by matching the `_<id>.json` suffix, or accept `--file`),
  re-encode the JSON to base64, and `PUT /settings/invoice-templates/{id}` with the re-encoded
  content in the correct field. Apply the read-guard/`assertSuccess` pattern to the response.
  Round-trip must be lossless (decode on pull → encode on update yields equivalent base64).
- Tests: pull decodes+writes JSON with `<name>_<id>.json` naming; non-HTML rejected; update
  re-encodes and PUTs to the right URL; round-trip decode→encode is stable.

### Task E — item #3: order-line-item create + pull confirmation
**Files:** verification-focused; `src/commands/orders.ts` only if a real bug is found.
- First, pull the EXISTING OLI order read-only: `pull order O-01339581` and confirm the written
  file embeds its 2 orderLineItems, and `pull order-line-item 8a8aa2a29fd1d135019fd2edee8f324b`
  returns the real line item. This validates the existing OLI pull path against a real record
  (it had never been exercised).
- Then, using ZDF's `create order` from a local file, create a NEW order that mimics O-01339581
  but is OLI-based and whose name/label includes `TEST ZDF POC` (authorized write). Pull it back
  and confirm its orderLineItems round-trip. Build the create body from the pulled O-01339581
  shape (strip ids/read-only fields via the existing `filterUpdatableFields` where applicable).
- If the pull path drops or mis-embeds OLIs, fix `rulesOrder`/`fetchAndWrite` accordingly with
  tests. If it already works, this task is verification + a regression test using the real shape.

## Enhanced 4-role agent loop (user-specified, per task)

For EACH task, run this loop until the task's live tests pass with zero open issues:
1. **Implementer** — implements the task (code + unit tests), commits.
2. **Adversarial test-case author** — assumes the implementer is WRONG on (a) code quality,
   (b) security, (c) feature correctness. Produces a concrete live test bed (exact commands +
   expected results) targeting those weaknesses. Does NOT run it; writes it to a file.
3. **Test executor** — runs that test bed against intQA (honoring the read-only rule + the two
   narrow write authorizations), records a list of concrete issues (or "clean").
4. If issues: back to the implementer to resolve; then re-author/re-run. Loop until clean.
Plus the standard per-task independent code review (spec + quality) before a task is marked done.
Controller coordinates only — never edits code itself.

## Verification (whole-branch)

1. `cd zdf && npm run build` succeeds; `npm test` passes (well above the 127 baseline).
2. Live intQA, output → `/tmp/zdf-poc-test`:
   - Task A: `--max-*` flags change limits; `--no-caps` warns; progress shows on a real pull.
   - Task B: `list orders --account ACG00018042` returns only that account's orders (3 live).
   - Task C: (unit-tested; live 401 hard to force) — no regression on normal calls.
   - Task D: `pull billing-template 8a8aa02e9fd1baf0019fd2ea46473db6` writes decoded JSON as
     `HTML_-_ZDF_POC_8a8aa02e9fd1baf0019fd2ea46473db6.json` (or sanitized equivalent); `update`
     PUTs the (unchanged) JSON back successfully — ONLY that template.
   - Task E: `pull order O-01339581` embeds 2 OLIs; a new `TEST ZDF POC` OLI order is created and
     pulls back with its OLIs.
3. Passing resource set and the three caps still work — no regression.
4. Clean up `/tmp/zdf-poc-test` after.
