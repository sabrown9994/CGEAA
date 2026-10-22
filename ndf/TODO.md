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

- **Explicit opt-in flag to deploy to production.** Today the only thing between a user and a
  production deploy is the branch guard: `deploy --target <prod>` is allowed as soon as the SDF
  project is on `main` (`commands/deploy.ts:39`) — with no further confirmation. Because NDF is
  **not** wired into CI/CD (see CI/CD Roadmap), a manual `cgeaa netsuite deploy --target
  CG-Production` from `main` is currently the *only* way to reach production, and it succeeds with no
  deliberate acknowledgement. Add a required opt-in flag (e.g. `--allow-production` / `--confirm-prod`,
  mirroring ZDF's `--allow-prod-financial`) that must be passed to deploy to the production auth ID,
  on top of the existing `main`-branch guard. Until it exists, prod deploys are documented as
  "manual, from `main`, no extra flag" (README / CLAUDE / How-To-Use). Implement via the NDF dev flow.

- **First live production deploy not yet verified.** The production path is guarded (inline checks in
  `switch` and `deploy` that block non-`main` branches) and unit-tested, but has never run against
  the real production environment. The first production deploy should be a supervised run from `main`
  after the feature branch merges.

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
  the same script files. **Blocked on the configurable-base item below** — do not wire CI until
  `--base` exists, or the pipeline will over-deploy. (Deferred by decision 2026-10-22: build the CI
  pipeline only after NDF is proven safe in day-to-day manual use by the team — see User Roll-out.)

- **Configurable diff base (`--base <ref>`) — prerequisite for CI.** Today `getMergeBase`
  (`helpers/git.ts`) hardcodes `git merge-base main HEAD` and diffs from whatever branch is checked
  out. This correctly isolates a feature's scripts/objects **only when run from that feature's own
  branch** (forked from `main`). It is **wrong for a CI job that fires on a push/merge to a
  long-lived env branch** (e.g. `qa`): with `HEAD = qa`, the scope becomes `merge-base(main, qa)..qa`
  = *everything accumulated in `qa` since it diverged from `main`* (all merged features), not the
  one feature that just landed. Over-deploys.
  - **Fix:** add `--base <ref>` to `build`/`deploy` (default `main`, so local behavior is unchanged),
    threaded into `getMergeBase(projectDir, base)`.
  - **Why one flag covers both:** merge-base of an ancestor and a descendant is the ancestor, so in
    CI passing `--base ${{ github.event.before }}` (the env branch's tip BEFORE the merge) makes the
    diff exactly `before..after` = only the just-merged feature's files; locally `--base main` keeps
    the fork-point behavior. (The existing `netsuite-deploy-scripts.yml` already uses
    `github.event.before` with a `HEAD~1` fallback — a working reference for this.)
  - **Edge cases for the eventual Action to handle:** brand-new branch (`github.event.before` is
    all-zeros), squash/force-push, and first-deploy — fall back to the PR base SHA from the event
    payload. Stays mono-repo-safe (the existing `--relative` filter already scopes the diff to
    `NetSuite/src`).
  - Implement via the NDF dev flow (implementer → standard → adversarial → intQA), then the Action
    can pass `--base`.

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
