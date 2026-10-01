# NDF — Status, Live intQA Findings & Open Work

NDF was built on `feature/netsuite-integration` (2026-09-11) via the subagent-driven flow with
per-task standard + adversarial review and live intQA verification. File/line references are to
`src/`.

---

## Development flow (REQUIRED for all follow-on work on this repo)

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

## ✅ What works (verified live against intQA, 2026-09-11)

| Command | Live intQA verification |
|---------|-------------------------|
| `envs` | Lists `CG-intQA` / `CG-UAT` / `CG-Production`; active marked `*`, production `[PROD]`; ANSI codes stripped; exit 0. |
| `switch <authId>` | Switches to a sandbox (writes `project.json`); switching **to** `CG-Production` from a non-`main` branch is correctly blocked; other `project.json` fields preserved; state restored after test. |
| `build` / `build --dry-run` | Generates feature-scoped `deploy.xml`/`manifest.xml`; dry-run prints without writing; paths correctly `~/`-prefixed with no mono-repo `NetSuite/` prefix. |
| `deploy` / `deploy --dry-run` | Production guard blocks a real deploy from a non-`main` branch when active env is production; `suitecloud project:deploy` invoked from the correct `cwd`; dry-run reaches suitecloud `--dryrun`. |
| `pull object <scriptId>` | `suitecloud object:import` imported `customscript1689` (with referenced files) from intQA; exit 0; no residual local changes after cleanup. |
| `pull file <path>` | `suitecloud file:import` imported a File Cabinet script from intQA; exit 0. |

Full suite: 47 Vitest tests across 11 files.

---

## 🐞 Bugs caught by the live-intQA stage (fixed)

These passed unit tests and code review but were caught only by running against the real
environment — evidence for why the live stage is required:

1. **Inverted `switch` production guard** (`commands/switch-env.ts`). The guard checked the
   *current* active auth ID instead of the *target* being switched to — it blocked switching *away*
   from production and allowed switching *to* production from a feature branch. Fixed to guard the
   target `authId` inline; `deploy` keeps the current-auth `checkProductionGuard`.

2. **Mono-repo path prefix** (`helpers/git.ts`). `git diff --name-only` run in a subdirectory of a
   mono-repo returns repo-root-relative paths (`NetSuite/src/...`), so the `src/...` filters matched
   nothing and every `build`/`deploy` silently reported "nothing to build". Fixed by adding
   `--relative`.

3. **`suitecloud` has no `--projectdir` flag** (`commands/deploy.ts`, `commands/pull.ts`).
   `project:deploy`/`object:import`/`file:import` reject `--projectdir`. Fixed to pass
   `cwd: projectDir` to `spawnSync` instead.

4. **Global install never copied NDF** (`../cgeaa-setup`, caught in final review). `install_ndf_globally`
   built NDF but didn't copy it to `/usr/local/share/cgeaa/ndf`, so `cgeaa netsuite` failed after a
   global install. Fixed to mirror `install_zdf_globally`'s copy step.

---

## 🔧 Open items / known limitations

- **[RETIRED 2026-10-01] manifest `<objects>` feature-scoped resolution.** Previously, `generateManifestXml` listed only the objects changed on the branch. This is now owned by `suitecloud project:adddependencies`, which computes and replaces the manifest `<objects>` section with the dependency set for the current scope. Feature-scoped manifest generation is no longer a concern.

- **manifest `projectname`/`frameworkversion` are hardcoded** to `NetSuite` / `1.0`
  (`helpers/xml.ts`). If a project uses different values, `build` will overwrite them. Should read
  them from the existing manifest. Low priority — matches the current `FinTech/NetSuite` project.

- **`sdfPath()` passthrough** (`helpers/xml.ts`). A path not starting with `src/` is emitted
  verbatim (no `~/` prefix). Not reachable today because `getChangedFiles` only ever yields `src/…`
  paths, but a defensive throw would harden it.

- **`writeCgeaaConfigKey` strips blank lines** from `~/.cgeaa/config` on every write
  (`helpers/config.ts`). Comments survive; only blank separators are lost. Cosmetic.

- **`config.test.ts` imports `beforeEach` but never uses it.** Lint nit.

- **`deploy --skip-tests` / `netsuite_run_tests` (ADDED 2026-09-29).** `suitecloud` v4 has no flag
  to bypass the `suitecloud.config.js` Jest hook, so skipping is a two-part mechanism: NDF sets
  `NDF_SKIP_TESTS=true` on the suitecloud subprocess (via `--skip-tests` or `netsuite_run_tests=false`),
  and the project's `suitecloud.config.js` `beforeExecuting` hook must skip Jest when that env var is
  set. **Verified live against intQA (2026-09-29, `--dryrun`):** with the toggle off, the hook runs
  and the branch's 3 failing `cg_vendor_bill_approval_*` tests block the deploy (exit 1); with
  `NDF_SKIP_TESTS=true`, the hook prints its skip message, Jest does not run, and the deploy proceeds
  past the gate. NDF clears `NDF_SKIP_TESTS` on the run-tests path so a stray shell value can't
  silently skip tests.
  - The `suitecloud.config.js` env-gated hook lives on the FinTech repo's `cicd/ndf` branch.
  - The `cg_vendor_bill_approval_*` test failures are a NetSuite-repo issue (branch script changes
    vs. un-updated tests), not an NDF bug.

- **Write-deploy + auto-build VERIFIED end-to-end (2026-09-29, intQA, tests-off).** On `cicd/ndf`
  with the config hook edit:
  - **File-only change** → `build` produced `deploy.xml` with `<files>` (no `<objects>`); deploy
    SUCCESS (17/17 steps, `FILE_UPLOAD`).
  - **Script + object change** → `build` produced `<files>` + `<objects>` and a `manifest.xml`
    listing the object id; deploy SUCCESS with `CUSTOM_OBJECT_VALIDATION` → `CUSTOM_OBJECT_UPDATE`
    (usereventscript + scriptdeployment) + both `FILE_UPLOAD`s.
  - **Failure path** — an object referencing an un-imported custom record
    (`[scriptid=customrecord_...]`) → SDF validation failed before deployment; NDF surfaced the
    unresolved-dependency error and exited 1. NDF does **not** auto-recover (see future feature).
  All test changes were reverted and intQA restored afterward.

- **No live production deploy has been (or should be) exercised.** The production path is guarded
  and only unit-tested; a real prod deploy happens from `main` after merge.

---

## ✅ Shipped features (2026-10-01)

- **Auto-import missing objects + retry deploy** (`deploy --target <authId> --source <authId> [--auto-import]`).
  When a deploy fails because a script/object references a custom object that isn't imported into the project, NDF parses the unresolved-dependency error, extracts named object IDs, runs `suitecloud object:import` for only those objects from `--source`, adds them to the build scope, and retries the deploy. **Gated design**: interactive (TTY) → confirm before importing; non-interactive (CI) → requires `--auto-import`, else fails with the named list. Capped at `MAX_ROUNDS=10` (default) to prevent infinite loops. Imported XML is left in the working tree for developer review. Account orchestration via `defaultAuthId` swap ensures imports come from `--source` and deploys go to `--target`. Verified live against intQA 2026-10-01.

---

## 💡 Future features (not needed yet)

---

## Out of scope (by design)

- NDF does not talk to NetSuite over HTTP — it orchestrates `suitecloud`.
- No workflow-specific commands — workflows migrate as ordinary custom objects via `pull object`
  and the SDF deploy.
- Single project per machine (`netsuite_project_dir`); no multi-project support.
- Promotion between environments is feature-branch → merge to `main`, not an NDF pipeline.
