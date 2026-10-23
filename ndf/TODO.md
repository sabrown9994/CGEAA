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

Work that must land (or be consciously accepted) before the team uses NDF day-to-day for manual,
feature-branch deploys. These are **not** CI items — they are about NDF being safe and complete
enough for a human to drive. Do these before the CI/CD Roadmap below.

- **Configurable diff base (`--base <ref>`) — prerequisite for *any* production deploy, and for CI.**
  `getMergeBase` (`helpers/git.ts:12`) hardcodes `git merge-base main HEAD`, and `build` diffs
  `merge-base..HEAD`. That only yields a non-empty changeset when `HEAD` is *ahead* of `main` — i.e.
  on a feature branch. Two consequences make production **currently unreachable** through NDF:
  - From a **feature branch**, `deploy --target <prod>` is blocked by the production guard.
  - From **`main`** (after the merge), `HEAD` *is* `main`, so `merge-base(main, HEAD)..HEAD` is empty;
    `build` prints "nothing changed vs main" and `process.exit(0)` (`build-runner.ts:22-25`) before
    any `suitecloud` deploy — a silent no-op. (True for fast-forward, merge-commit, and squash merges
    alike: the merge-base of `main` with itself is always itself.)

  So there is no working path to deploy a merged feature to production today. **Fix:** add
  `--base <ref>` to `build`/`deploy` (default `main`, so feature-branch behavior is unchanged),
  threaded into `getMergeBase(projectDir, base)`. To deploy a just-merged feature from `main`, pass
  `--base <pre-merge-SHA>` so the diff is `before..main` = exactly that feature. This is the same
  mechanism CI needs (`${{ github.event.before }}`), so it unblocks both manual prod deploys and the
  CI pipeline. It is also **wrong for a CI job firing on a long-lived env branch** without it: with
  `HEAD = qa`, scope becomes `merge-base(main, qa)..qa` = every feature accumulated in `qa`.
  - **Edge cases:** brand-new branch (`github.event.before` all-zeros), squash/force-push, and
    first-deploy — fall back to the PR base SHA. Mono-repo-safe (the `--relative` filter already
    scopes the diff to `NetSuite/src`). The existing `netsuite-deploy-scripts.yml` already uses
    `github.event.before` with a `HEAD~1` fallback — a working reference.
  - Implement via the NDF dev flow (implementer → standard → adversarial → intQA).

- **Explicit opt-in flag to deploy to production.** Even once `--base` makes prod deploys functional,
  the branch guard (`commands/deploy.ts:39`) is the *only* gate: from `main`, a prod deploy would
  proceed with no deliberate acknowledgement. Add a required opt-in flag (e.g. `--allow-production` /
  `--confirm-prod`, mirroring ZDF's `--allow-prod-financial`) that must be passed to deploy to the
  production auth ID, on top of the `main`-branch guard. Pair this with the `--base` work so the
  first functional prod deploy already requires the deliberate flag. Implement via the NDF dev flow.

- **First live production deploy not yet verified.** The production path is guarded (inline checks in
  `switch` and `deploy` that block non-`main` branches) and unit-tested, but has never run against
  the real production environment — and, per the `--base` item above, cannot succeed at all until
  that lands. The first production deploy should be a supervised run from `main` once it is functional.

- **manifest `projectname`/`frameworkversion` are hardcoded** to `NetSuite` / `1.0`
  (`helpers/xml.ts`). If a project uses different values, `build` will overwrite them. Should read
  them from the existing manifest. Low priority — matches the current `FinTech/NetSuite` project.

- **`sdfPath()` passthrough** (`helpers/xml.ts`). A path not starting with `src/` is emitted
  verbatim (no `~/` prefix). Not reachable today because `getChangedFiles` only ever yields `src/…`
  paths, but a defensive throw would harden it.

- **`writeCgeaaConfigKey` strips blank lines** from `~/.cgeaa/config` on every write
  (`helpers/config.ts`). Comments survive; only blank separators are lost. Cosmetic.

- **`config.test.ts` imports `beforeEach` but never uses it.** Lint nit.

---

## CI/CD Roadmap

NDF will eventually **own** the NetSuite CI/CD deploy path, but it cannot today — it is not invoked
by any GitHub Action, so nothing in NDF runs on a push or merge. (Note: a *separate*, pre-existing
FinSys workflow, `.github/workflows/netsuite-deploy-scripts.yml`, does auto-deploy on push to
`qa`/`staging`/`main` — but it is **not** NDF: it runs `suitecloud file:upload` of changed
`SuiteScripts/**` files only, with no Objects, no manifest, no SDF `project:deploy`, and no
production opt-in. On `main` it uploads straight to the production account.)

- **GitHub Action that uses NDF for script *and* object deployment; retire the existing file-upload
  workflow.** Build a CI pipeline that runs `cgeaa netsuite deploy` on merges to FinSys environment
  branches, so deploys go through NDF's feature-scoped build (scripts **and** `src/Objects/**`),
  manifest/dependency resolution, and the production opt-in — not the scripts-only `file:upload`
  path. As part of this, **remove `.github/workflows/netsuite-deploy-scripts.yml`** (the hand-rolled
  file-upload deploy) so there is a single, NDF-owned deploy path and the two cannot double-deploy
  the same script files. **Blocked on the `--base` item (now in User Roll-out above)** — do not wire
  CI until `--base` exists, or the pipeline will over-deploy. (Deferred by decision 2026-10-22: build
  the CI pipeline only after NDF is proven safe in day-to-day manual use by the team — see User
  Roll-out.)

- **Guard against building from a shared branch.** Complementary safety: NDF could warn (or require
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
