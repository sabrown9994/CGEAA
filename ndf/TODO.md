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

## Remaining open items (deferred minors)

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

## Validation milestone

**No live production deploy has been exercised yet.** The production path is guarded (inline checks
in `switch` and `deploy` commands that block non-`main` branches) and unit-tested, but has not been
verified against the real production environment. First production deploy will happen from `main`
after the feature branch merges.

---

## Roadmap

- **GitHub Actions workflow**: Wire an actual CI pipeline that runs `cgeaa netsuite deploy` on
  merges to FinSys environment branches. Currently only a README snippet exists; no committed
  `.github/workflows/*.yml` file. **Blocked on the configurable-base item below** — do not wire CI
  until `--base` exists, or the pipeline will over-deploy. (Deferred by decision 2026-10-22: build
  the CI pipeline only after the feature is proven safe in day-to-day use by the team.)

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
    the fork-point behavior.
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
