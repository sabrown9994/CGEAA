# NDF — TODO & Open Work

## Required development flow (STANDING CONTRACT)

Every non-trivial NDF change follows this process:

1. **Multi-agent, subagent-driven** — a fresh implementer subagent per task; the controller
   coordinates and never fixes code itself.
2. **Standard reviewer** — spec compliance + code quality after each task.
3. **Adversarial reviewer** — a dedicated agent that assumes everything the implementer did is
   wrong and tries to break it before accepting.
4. **Live intQA test (with cleanup)** — for tasks that make real `suitecloud` calls, verify against
   the live NetSuite intQA environment (`CG-intQA`, `3595813-sb6.app.netsuite.com`). **Any state
   touched during a test (active auth in `project.json`, imported files, deployed changes) must be
   reverted to its original state when the test completes.**
5. Every code change ships with Vitest tests; `cd ndf && npm run build && npm test` must pass.

Never deploy to production (`CG-Production`) during testing. Live deploy tests target `CG-intQA`
only and revert.

---

## User Roll-out

Most of this section **shipped** on `feature/netsuite-integration` (NDF dev flow: per-task
implementer → standard + adversarial review → final whole-branch review; 82 tests pass). Production
is now reachable through a deliberate, manual path. The one remaining item is a supervised first
production deploy, which is blocked on valid production auth (see below).

**Shipped:**

- **`--base <ref>` on `build`/`deploy`** (default `main`). This makes production reachable:
  `getMergeBase(projectDir, base)` lets you deploy a just-merged feature from `main` with
  `cgeaa netsuite deploy --target CG-Production --base <pre-merge-SHA> --allow-production` — the diff
  becomes `before..main` = exactly that feature. (Default `main` keeps feature-branch behavior
  identical; from `main` with no `--base`, the diff is still empty and deploy is a no-op, by design.)
  `base` is validated against shell- **and** git-option injection (leading-dash rejected — caught by
  adversarial review). Same mechanism CI will use (`${{ github.event.before }}`).

- **`--allow-production` opt-in flag on `deploy`.** Deploying to the production auth ID now requires
  BOTH the `main`-branch guard AND `--allow-production`, enforced before any `defaultAuthId` swap or
  network call. Mirrors ZDF's `--allow-prod-financial`.

- **manifest `projectname`/`frameworkversion`** are now read from the existing manifest (fallback
  `NetSuite` / `1.0`, including empty/malformed tags). **`sdfPath()`** throws on a non-`src/` path
  instead of emitting it verbatim. (`helpers/xml.ts`.)

- **`writeCgeaaConfigKey`** preserves blank lines and comments in `~/.cgeaa/config`; removed the
  unused `beforeEach` test import. (`helpers/config.ts`, `__tests__/helpers/config.test.ts`.)

**Remaining:**

- **First live production deploy not yet verified — blocked on valid production auth.** A read-only
  connectivity check (`suitecloud object:list --type role` against `CG-Production`) on 2026-10-23
  found the local `CG-Production` auth token is **expired**: suitecloud fell back to browser-based
  re-authentication, which timed out. No writes occurred. Before any production deploy: (1) refresh
  the token with `suitecloud account:setup` for `CG-Production` (interactive, browser), then (2) do a
  **supervised** first deploy from `main` with `--base <pre-merge-SHA> --allow-production`. Until the
  token is refreshed, production is unreachable for an operational reason (auth), not a code one.

- **✅ DONE (`rollout` 9703ce6) — `cgeaa netsuite envs` no longer hard-fails when `netsuite_production_auth_id` is unset.** `envs`
  calls `getProductionAuthId()` before listing (`commands/envs.ts:19`), purely to render the `[PROD]`
  marker (`envs.ts:24`), so a half-configured machine (project dir set, production auth id not) makes
  a read-only listing throw `netsuite_production_auth_id not configured. Run 'cgeaa netsuite setup'…`
  and print nothing. Fix: `envs` should still list the environments when the prod id is unset —
  omit/soften the `[PROD]` marker and print a one-line hint ("production not yet configured — run
  `cgeaa netsuite setup`") instead of throwing. Keep the hard requirement on `switch`/`deploy`, where
  it is a genuine safety gate (the production guard). Context: the half-configured state arises
  because `setup` writes `netsuite_project_dir` (Step 1) before `netsuite_production_auth_id`
  (Step 3), so an incomplete `setup` run (bailed at the auth step / Ctrl-C) leaves the prod id unset;
  making `setup` write both keys atomically was **considered and declined (2026-11-11)** — the chosen
  remedy is this graceful `envs` degradation plus the re-run-setup / manual-config-line workaround.

---

## CI/CD Roadmap

NDF will eventually **own** the NetSuite CI/CD deploy path, but it cannot today — it is not invoked
by any GitHub Action, so nothing in NDF runs on a push or merge. (Note: a *separate*, pre-existing
FinSys workflow, `.github/workflows/netsuite-deploy-scripts.yml`, does auto-deploy on push to
`qa`/`staging`/`main` — but it is **not** NDF: it runs `suitecloud file:upload` of changed
`SuiteScripts/**` files only, with no Objects, no manifest, no SDF `project:deploy`, and no
production opt-in. On `main` it uploads straight to the production account.)

**Execution guardrails (standing, set 2026-11-11):**
1. All FinSys-repo development happens **only on the `cicd/netsuite` branch**.
2. Before developing on `cicd/netsuite`, verify it is **up to date with `main` except the CI-pipeline
   files** — 0 commits behind `origin/main`, divergence limited to `.github/workflows/netsuite-deploy-ndf.yml`.
   (Verified 2026-11-11: local `cicd/netsuite` is main + 1 commit, that one file only.) If behind, sync
   onto `main` first so the pipeline is tested against current NetSuite code.
3. **No production deployments — test only in intQA (`CG-intQA`) and StagingUAT (`CG-UAT`).** The
   drafted workflow's `main`→`CG-Production` path stays **dormant/gated** until an explicit prod
   cutover is approved; exercise only qa→intQA, staging→UAT, and `cicd/netsuite-test/**`→intQA.
4. The enhanced NDF workflow **coexists with** the legacy `netsuite-deploy-scripts.yml` (it does not
   delete it). Goal: NDF eventually replaces it; meanwhile the legacy stays a **disable-able
   fallback** to turn back on if the NDF workflow misbehaves. An existing workflow on `cicd/netsuite`
   serves as the guiding template.

**Phasing (ordered — set 2026-11-11):**
- **Phase 1 — Prove the deploy pipeline with tests OFF.** Get the NDF workflow building and deploying
  scripts **and** objects to the sandboxes (qa→`CG-intQA`, staging→`CG-UAT`, `cicd/netsuite-test/**`→
  `CG-intQA`) with Jest **skipped** (`netsuite_run_tests=false` / `--skip-tests` → `NDF_SKIP_TESTS=true`).
  Rationale: the suite barely exists (~3 tests vs ~108 scripts), so the first milestone is proving
  build→auth→scope→deploy end-to-end **without** depending on a test gate. Prod path stays dormant.
- **Phase 2 — Build the Jest test suite (FINT-17160).** Only after Phase 1 works: author real Jest
  coverage (and script docs) for the SuiteScripts, keeping the `__tests__/` + relative-`require`
  convention. See the dedicated FinSys item below.
- **Phase 3 — Turn the test gate on + scope it.** Stop skipping tests (unset the skip), then layer on
  the "Scoped test execution" plan (`NDF_CHANGED_SCRIPTS` → `findRelatedTests`) so deploys run only
  the tests related to the changed scripts.
- **(Later) Production cutover** — only after the above is proven and with explicit approval (guardrail 3).

- **GitHub Action that uses NDF for script *and* object deployment; retire the existing file-upload
  workflow.** Build a CI pipeline that runs `cgeaa netsuite deploy` on merges to FinSys environment
  branches, so deploys go through NDF's feature-scoped build (scripts **and** `src/Objects/**`),
  manifest/dependency resolution, and the production opt-in — not the scripts-only `file:upload`
  path. As part of this, **remove `.github/workflows/netsuite-deploy-scripts.yml`** (the hand-rolled
  file-upload deploy) so there is a single, NDF-owned deploy path and the two cannot double-deploy
  the same script files. The `--base` prerequisite is now **shipped** (see User Roll-out), so CI is
  unblocked technically — the Action passes `--base ${{ github.event.before }}` and
  `--auto-import`/`--allow-production` as appropriate. (Still deferred by decision 2026-10-22: build
  the CI pipeline only after NDF is proven safe in day-to-day manual use by the team.)

- **Test the NDF CI workflow end-to-end (user roll-out validation).** The NDF-driven deploy workflow
  exists in FinSys at `.github/workflows/netsuite-deploy-ndf.yml` on branch `cicd/netsuite` (committed,
  not yet pushed/activated — the user pushes when ready to test). Validate before any real cutover:
  (1) add the `CGEAA_REPO_TOKEN` secret (read access to `sabrown9994/CGEAA`); (2) push `cicd/netsuite`
  and fork a `cicd/netsuite-test/**` branch; (3) merge a trivial script+object change and confirm the
  run builds cgeaa, auths to `CG-intQA`, and `cgeaa netsuite deploy` scopes to exactly that change
  (inspect generated `deploy.xml`), and deploys to the sandbox **with tests skipped**
  (`netsuite_run_tests=false` / `--skip-tests`) — this is **Phase 1**, proving the deploy mechanism,
  not the test gate (tests are turned on in Phase 3, after the suite exists); (4) negative test — a
  change referencing a missing object must fail loudly; (5) cut over qa → staging (sandboxes only;
  `main`/prod gated per guardrail 3), deactivating the legacy `netsuite-deploy-scripts.yml` per env as
  each is proven. Repin the workflow's CGEAA `ref` to a release tag before any `main` cutover.

- **Scoped test execution — run only the Jest tests related to changed scripts (deploy/CI speedup).**
  Today the FinSys `suitecloud.config.js` `beforeExecuting` hook runs the **whole** Jest suite on
  every `project:deploy` (`SuiteCloudJestUnitTestRunner.run({})`). As the suite grows (see FINT-17160)
  this makes every deploy/CI run slower than it needs to be. Run only the tests related to the
  scripts a deploy actually changed.

  **Enabler (verified 2026-11-11, read-only):** `SuiteCloudJestUnitTestRunner.run(args)` forwards
  `args` straight to `jest.runCLI(args, projectFolder)`, so the hook can pass Jest selection options.
  `jest --findRelatedTests <scriptPaths…>` selects only the test files that import those scripts.
  Fidelity proven with the SuiteCloud preset via `jest … --listTests`:
    - `--findRelatedTests src/FileCabinet/SuiteScripts/cg_vendor_bill_approval_mr_ss.js` → selected
      exactly `__tests__/cg_vendor_bill_approval_mr_ss.test.js`.
    - the same for an **untested** script (`cg_vendor_bill_approval_flip_ss.js`) → selected **no**
      tests (confirms the empty-set → skip rule below).
    Resolution works because the tests import their target by relative path
    (`require('../src/FileCabinet/SuiteScripts/<script>')`); keep that convention (ties to FINT-17160).

  **Recommended shape — producer/consumer split:**
  1. **[CGEAA / NDF — `ndf/src/commands/deploy.ts`]** NDF already computes `changed.scripts`
     (`helpers/git.ts getChangedFiles`, with the correct `--base`, local and CI). Export those
     changed SuiteScript paths (absolute, delimiter-joined) to the `project:deploy` subprocess as a
     new env var (e.g. `NDF_CHANGED_SCRIPTS`) on the **same `env` object that already carries
     `NDF_SKIP_TESTS`** (`deploy.ts:56-70`). Scripts only (`src/FileCabinet/SuiteScripts/**`); objects
     have no unit tests. The GitHub Action needs **no** change — this rides inside `cgeaa netsuite
     deploy` for both local and CI. Ship via the NDF dev flow with Vitest coverage.
  2. **[FinSys repo — `NetSuite/suitecloud.config.js` hook]** when `NDF_SKIP_TESTS !== 'true'`, read
     `NDF_CHANGED_SCRIPTS` and:
       - non-empty → `run({ findRelatedTests: true, _: [<paths>] })` (only related tests);
       - **empty** (object/config-only change, or no scripts changed) → **skip** — run nothing, do
         NOT fall back to the full suite (decision 2026-11-11);
       - **absent** (hook invoked outside NDF, e.g. a direct `suitecloud project:deploy`) → `run({})`
         full suite, preserving today's behavior for non-NDF callers.
     Track this FinSys-side change against **FINT-17160** (which also creates the suite this scoping
     runs over). See the dedicated FinSys item below.

  **Decisions (2026-11-11):**
    - Empty changed-scripts set → **skip** (no full-suite fallback).
    - **Production is scoped too** — prod deploys run only the related tests, identical to every other
      env (no full-suite-on-prod). NDF exports `NDF_CHANGED_SCRIPTS` regardless of `--target`, and the
      hook treats prod like any other environment.
    - Back-compat preserved only for the **absent** var (non-NDF caller) → full suite.

  **Sequencing:** scoping only pays off once real coverage exists — **FINT-17160** ("Create NetSuite
  Script Documentation and Test Suite", epic FINT-16342) is the prerequisite. Build/validate scoped
  execution alongside or after it. Validate end-to-end: a changed tested script runs only its test; a
  changed untested script runs nothing; an object-only change runs nothing; a changed shared lib runs
  all transitively-related tests.

- **[FinSys repo] `NetSuite/suitecloud.config.js` hook — consume `NDF_CHANGED_SCRIPTS` for scoped
  test runs (FINT-17160).** The consumer half of the "Scoped test execution" item above: when
  `NDF_SKIP_TESTS` is unset, branch on `NDF_CHANGED_SCRIPTS` → `findRelatedTests` for a non-empty
  list, **skip** for an empty list, full suite when the var is absent. Depends on the NDF producer
  change (exporting `NDF_CHANGED_SCRIPTS`) and on FINT-17160 delivering the test suite this scopes
  over. FinSys-repo change (same file the `NDF_SKIP_TESTS` gate already lives in); not a CGEAA edit.

- **[FinSys repo] Build out the NetSuite Jest test suite + script docs (FINT-17160) — PHASE 2 (do
  after Phase 1 proves the test-less workflow).** Today there
  are ~3 real test files vs ~108 SuiteScripts, so the deploy/CI test gate is near-cosmetic. FINT-17160
  ("Create NetSuite Script Documentation and Test Suite", epic FINT-16342) tracks authoring Jest
  coverage (and design docs) for the SuiteScripts. Keep the existing `__tests__/` + relative-`require`
  convention so NDF/CI run them automatically (and so `findRelatedTests` scoping resolves). Owned by
  the FinSys/SuiteScript side, not CGEAA/NDF — listed here only because the two CI items above depend
  on it.

- **✅ DONE ([FinSys] `cicd/netsuite` db0a5ad1 — local, pending push/MR) — Pin third-party GitHub Actions to commit SHAs in `netsuite-deploy-ndf.yml`.**
  Semgrep Guardian flagged (2026-11-11, after rebasing `cicd/netsuite` onto `main`) four mutable
  action-tag references in FinSys `.github/workflows/netsuite-deploy-ndf.yml` — rule
  `github-actions-mutable-action-tag` (WARNING). A floating `@v5` tag can be silently repointed by the
  action owner, a supply-chain risk (cf. the trivy-action / kics-github-action compromises). Pin each
  to a full 40-char commit SHA, keeping a trailing `# v5` comment:
    - line 36 `uses: actions/checkout@v5`
    - line 47 `uses: actions/setup-node@v5`
    - line 52 `uses: actions/setup-java@v5`
    - line 62 `uses: actions/checkout@v5`
  This is a FinSys-repo change on branch `cicd/netsuite` (the only file that branch diverges from
  `main` by). Fold it into the existing NDF workflow commit or add a follow-up commit. Do this before
  the `main` cutover, alongside repinning the CGEAA `ref` to a release tag (see item above).

- **✅ DONE (`rollout` 9703ce6) — Guard against building from a shared branch.** Implemented as the
  non-blocking `warnIfSharedBranch()` helper, called once per `build`/`deploy`. Original intent:
  NDF could warn (or require
  a confirm) when `build`/`deploy` runs with `HEAD` on a known shared/integration branch
  (`main`/`qa`/`uat`) rather than a feature branch, since that's the scenario where the diff scope is
  likely unintended. Document the standing rule in the meantime: **run `build`/`deploy` from your
  feature branch, not from a shared env branch.**

---

## Out of scope (by design)

- NDF does not talk to NetSuite over HTTP — it orchestrates `suitecloud`.
- No workflow-specific commands — workflows deploy as ordinary custom objects via `pull object`
  and the standard SDF deploy.
- Single project per machine (`netsuite_project_dir`); no multi-project support.
- Promotion between environments is feature-branch → merge to `main`, not an NDF pipeline.
