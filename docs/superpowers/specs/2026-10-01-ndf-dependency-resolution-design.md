# NDF Dependency Auto-Resolution — Design Spec

**Date:** 2026-10-01
**Branch:** feature/netsuite-integration (CGEAA repo)
**Status:** Approved for implementation (pending spec review)
**Builds on:** `2026-09-11-cgeaa-netsuite-cli-design.md`

---

## Context & goal

NDF's `build` currently generates `deploy.xml` + `manifest.xml` purely from the git diff, and
`deploy` runs `suitecloud project:deploy` once. If a changed script/object references a custom
object that isn't declared in the manifest (or isn't present in the target account), the deploy
fails on an unresolved dependency and NDF just surfaces the error (verified 2026-09-29).

Goal: make `deploy` **auto-resolve** those dependency failures using a **hybrid** strategy — lean on
SDF's own `project:adddependencies` for the common "manifest under-declared" case, and, only for
objects that are genuinely absent from the target, **import the specifically-named objects from a
source account** (gated), rebuild, and retry — bounded so it cannot "go rampant." This supports two
workflows: a developer running it locally before merging a feature branch, and GitHub Actions
running it on merge into an environment branch.

## Global constraints

- TypeScript, CJS, Node16 resolution — all internal imports use `.js`. Vitest with `vi.hoisted`.
- No new runtime deps beyond the existing `commander`/`chalk` (child_process/fs/readline are stdlib).
- Commits stage only explicit `ndf/` paths — never `git add -A`.
- `cd ndf && npm run build && npm test` must pass before each commit.
- **Minimal-by-construction imports:** NDF imports ONLY object script IDs that SDF explicitly names
  as missing in its own error output — never a speculative dependency crawl.
- **suitecloud has no per-command account flag** — account selection is done by swapping
  `project.json` `defaultAuthId`, always restored (including on failure).
- The production guard still applies to the effective `--target`.
- Live verification runs against intQA only, via the required NDF dev flow (standard → adversarial →
  intQA with cleanup), on the FinSys `cicd/ndf` branch (ask the user to be on that branch first).

---

## Command surface

```
cgeaa netsuite build  [--dry-run]
cgeaa netsuite deploy --target <authId> [--source <authId>] [--auto-import] [--dry-run]
                      [--skip-tests] [--max-import-rounds <n>]
```

- **`build`** (offline prep): generate `deploy.xml` from the git diff, then run
  `suitecloud project:adddependencies` to let SDF populate the manifest `<dependencies>`. This
  **replaces NDF's hand-rolled `<objects>` manifest list** (retires deferred-minor #1). `--dry-run`
  prints the generated files and does not write them.
- **`deploy`** owns the resolution loop. `--target` is **required** (deploy destination).
  `--source` is the origin for imports — consumed only if an absent-object import is needed.
  `--auto-import` permits the import step unattended (CI). `--skip-tests` / `netsuite_run_tests`
  behavior is unchanged. `--dry-run` runs the full resolve loop using `project:validate`
  (not a real deploy) and imports nothing (preview only).
- `--target`/`--source` must be auth IDs present in `suitecloud account:manageauth --list`; NDF
  validates them up front and errors clearly if unknown.

## Account model & `defaultAuthId` swap

`AccountSwitcher` helper wraps every suitecloud call that must run against a specific account:

1. Read and remember the current `project.json` `defaultAuthId` (the "restore value") once, at the
   start of `deploy`.
2. Before an operation against account X: write `defaultAuthId = X`.
3. Run the suitecloud command.
4. In a `finally` at the end of `deploy` (success, failure, or thrown): write the restore value
   back. Never leave `project.json` pointing somewhere the user didn't choose.

- Imports run with `defaultAuthId = --source`; `adddependencies`/`validate`/`deploy` run with
  `defaultAuthId = --target`.
- **Production guard:** evaluated against `--target` before any swap/deploy. If `--target` is the
  production auth ID and the branch isn't `main`, block immediately (no swap performed).
- Concurrency note: documented as not safe to run two NDF deploys against the same project
  simultaneously (they share `project.json`). Acceptable for the local + CI-per-branch model.

## The resolution loop (in `deploy`)

```
deploy(--target T, --source S?, --auto-import?, --dry-run?, --skip-tests?):
  guard: production check on T
  remember restoreAuthId = project.json.defaultAuthId
  try:
    runBuild()                       # deploy.xml from diff + adddependencies (against T)
    round = 0
    imported = []                    # cumulative, for the summary
    loop:
      round += 1
      set defaultAuthId = T
      result = validate-or-deploy(T)         # --dry-run → project:validate; else project:deploy
      if result.success: break (SUCCESS)
      missing = parseMissingObjectRefs(result.output)   # script IDs SDF names as missing
      if missing is empty:
        FAIL — surface the error unchanged (not a resolvable missing-object dependency)
      if round > MAX_ROUNDS:
        FAIL — cap tripped; surface what was imported so far + remaining missing
      # resolve the named-missing objects
      if --dry-run:
        report "would import: <missing>" and STOP the loop (no import, no retry) — preview only
      gate: decide import permission (see Guardrails)
      if import not permitted:
        FAIL — print the named-missing list + how to proceed (supply --source / --auto-import)
      set defaultAuthId = S
      object:import(missing)                 # only the named ones; --type ALL for those IDs
      imported += missing
      set defaultAuthId = T
      adddependencies()                       # re-declare after new objects added
      rebuild deploy.xml to include newly-imported object paths
      # loop retries
  finally:
    set defaultAuthId = restoreAuthId
  report: SUCCESS/FAIL + the list of imported objects (if any)
```

- `adddependencies` first (declare case) is handled implicitly: `runBuild` already ran it, and it's
  re-run after each import. Objects that merely needed declaring never reach the import branch,
  because once declared+present-in-target they stop appearing in the error.
- Only objects SDF **names** are imported; the transitive set is discovered one round at a time.

## Error parsing

`parseMissingObjectRefs(output: string): string[]`

- Match SDF's documented missing-reference lines, e.g.:
  `The object reference [scriptid=<id>] is missing in the project and also not included in the
  dependencies list.`
- Extract the `scriptid=` value(s); dedupe; return the list.
- Robustness: a dedicated, unit-tested regex over the known phrasing. If the output contains
  dependency-style errors NDF cannot parse into concrete script IDs, treat `missing` as empty →
  the loop FAILS and surfaces the raw error rather than guessing. **Parsing failure degrades to the
  current behavior; it never imports something unnamed.**
- The exact SDF phrasings are **verified live on `cicd/ndf` as the first implementation task**
  (see "SDF behaviors to verify") so the regex matches reality, not assumption.

## Guardrails (the "don't go rampant" controls)

1. **Named-only:** import exactly the script IDs parsed from SDF errors — never inferred extras.
2. **Cap:** `MAX_ROUNDS` (default 10) — the maximum number of import+retry iterations. Hitting it
   fails with a clear message listing what was imported and what's still missing. Overridable via
   `--max-import-rounds` for unusual cases. (Each round imports only the objects SDF names that
   round, so rounds bound total imports; there is no separate object-count cap.)
3. **Gating (local vs CI):**
   - Interactive TTY: print the exact list of objects about to be imported from `--source` and
     require confirmation before importing. Decline → fail without importing.
   - Non-interactive (CI): import only if `--auto-import` is set; otherwise fail with the named
     list so a human decides. (Detect via `process.stdin.isTTY`, matching ZDF's pattern.)
4. **Source required for import:** if an import is needed and `--source` is absent → prompt for it
   from the env list (local) or fail asking for it (CI).
5. **Preview always:** whether or not confirmation is required, the imported set is printed and
   included in the final summary.

## CI / GitHub Actions usage

- A workflow on merge into an environment branch runs:
  `cgeaa netsuite deploy --target <env-authid> --source <lower-env-authid> --auto-import --skip-tests?`
- Non-interactive, so `--auto-import` is mandatory for the import step; without it the job fails
  with the named-missing list (safe default).
- Auth in CI uses the existing suitecloud CI auth mechanism (auth IDs configured on the runner);
  NDF only swaps `defaultAuthId` among already-configured IDs.
- Document the recommended workflow YAML in README-NDF.md.

## Testing strategy

- **Unit (Vitest, mocked `child_process`/`fs`):**
  - `parseMissingObjectRefs`: single/multiple/none/dedupe; non-matching dependency errors → `[]`.
  - `AccountSwitcher`: sets/restores `defaultAuthId`; restores on thrown error.
  - deploy loop: success first try; one import round then success; cap-tripped failure;
    unparseable-error failure; gating (TTY confirm vs CI `--auto-import` vs CI fail);
    source-missing prompt/fail; production guard on `--target`.
  - `build`: calls `adddependencies`; `--dry-run` writes nothing.
- **Live intQA (NDF dev flow, on `cicd/ndf`):** reproduce an absent-object dependency, confirm the
  loop imports only the named object from `--source`, redeploys green, and that caps/gating behave.
  Revert all intQA + repo state afterward (redeploy originals; restore `project.json`).

## SDF behaviors to verify FIRST (implementation task 1, on cicd/ndf)

1. Does `project:adddependencies` require an account connection, and which account's context does it
   use? (Confirms whether `build` needs a `--target`/auth to run it.)
2. Exact text of the missing-object / unresolved-dependency error lines (drives the regex).
3. Does `project:validate` surface the same missing-ref errors as `project:deploy` (needed for
   `--dry-run` preview)?
4. Confirm `object:import --scriptid <id> --type ALL` imports a single named object cleanly and that
   re-`adddependencies` + redeploy then succeeds.

These are a short spike at the top of the plan; findings adjust the regex/flow before building out.

## Production guard interaction

- `deploy` evaluates the guard on `--target` (not `project.json`'s pre-swap value). Production
  target off `main` → blocked before any swap or network call.
- Imports never target production (source is a non-prod lower env by workflow); no special casing
  needed, but the guard on `--target` is the hard stop.

## Out of scope

- Importing objects from anywhere other than a single `--source` account per run.
- Resolving non-object dependencies (features, roles beyond what `adddependencies` handles).
- Any auto-commit of imported objects — NDF leaves imported object XML in the working tree for the
  developer to review/commit (CI commits per its own workflow policy, outside NDF).
- Multi-project / concurrent deploys against the same `project.json`.
