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

- **manifest `<objects>` is feature-scoped, not a full scan.** `generateManifestXml` lists only the
  objects changed on the branch (per the design decision). If SDF dependency resolution rejects a
  deploy because a referenced object isn't in the manifest, switch to scanning all of
  `src/Objects/` (a `--full-manifest` flag was noted as the escape hatch). `helpers/xml.ts`.

- **manifest `projectname`/`frameworkversion` are hardcoded** to `NetSuite` / `1.0`
  (`helpers/xml.ts`). If a project uses different values, `build` will overwrite them. Should read
  them from the existing manifest. Low priority — matches the current `FinTech/NetSuite` project.

- **`sdfPath()` passthrough** (`helpers/xml.ts`). A path not starting with `src/` is emitted
  verbatim (no `~/` prefix). Not reachable today because `getChangedFiles` only ever yields `src/…`
  paths, but a defensive throw would harden it.

- **`writeCgeaaConfigKey` strips blank lines** from `~/.cgeaa/config` on every write
  (`helpers/config.ts`). Comments survive; only blank separators are lost. Cosmetic.

- **`config.test.ts` imports `beforeEach` but never uses it.** Lint nit.

- **`deploy --skip-tests` was dropped.** `suitecloud` v4 has no flag to bypass the
  `suitecloud.config.js` Jest hook, and we chose not to edit the SDF repo's config. The project's
  own pre-existing failing unit tests (`cg_vendor_bill_approval_*`) will block a real deploy until
  fixed in the NetSuite repo — that is a NetSuite-repo issue, not an NDF bug.

- **No live production deploy has been (or should be) exercised.** The production path is guarded
  and only unit-tested; a real prod deploy happens from `main` after merge.

---

## Out of scope (by design)

- NDF does not talk to NetSuite over HTTP — it orchestrates `suitecloud`.
- No workflow-specific commands — workflows migrate as ordinary custom objects via `pull object`
  and the SDF deploy.
- Single project per machine (`netsuite_project_dir`); no multi-project support.
- Promotion between environments is feature-branch → merge to `main`, not an NDF pipeline.
