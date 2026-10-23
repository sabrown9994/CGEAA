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
  the same script files. The `--base` prerequisite is now **shipped** (see User Roll-out), so CI is
  unblocked technically — the Action passes `--base ${{ github.event.before }}` and
  `--auto-import`/`--allow-production` as appropriate. (Still deferred by decision 2026-10-22: build
  the CI pipeline only after NDF is proven safe in day-to-day manual use by the team.)

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
