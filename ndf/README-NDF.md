# NDF — NetSuite Development Framework

NDF is a TypeScript CLI that wraps Oracle's SuiteCloud SDK (`suitecloud`) for **feature-branch
NetSuite development**. It is invoked through the top-level `cgeaa` binary as `cgeaa netsuite <command>`.

Its headline feature is **auto-generating feature-scoped `deploy.xml` and `manifest.xml`** from a
git diff, so a feature branch deploys only the scripts and objects that branch actually changed —
and the generated files are committed so PR reviewers can see the exact deployment scope.

```bash
cgeaa netsuite envs                    # list environments, mark active + production
cgeaa netsuite switch CG-intQA         # change the active environment
cgeaa netsuite build                   # generate deploy.xml + manifest.xml from git diff
cgeaa netsuite deploy                  # build, then suitecloud project:deploy
cgeaa netsuite pull object <scriptId>  # import a custom object from NetSuite
```

## Prerequisites

- **Node.js ≥ 18** (NDF builds to `dist/ndf.js`)
- **`suitecloud` CLI** on `$PATH` (`@oracle/suitecloud-cli`) — NDF shells out to it
- **A SuiteCloud SDF project** on disk (an Account Customization Project with `suitecloud.config.js`,
  `project.json`, and a `src/` folder containing `FileCabinet/`, `Objects/`, `AccountConfiguration/`)
- **Authenticated NetSuite environments** — set up with `suitecloud account:setup` /
  `suitecloud account:manageauth`

## One-time setup

Run either the full CGEAA installer (which offers NetSuite as an optional section) or the
standalone NetSuite setup:

```bash
cgeaa netsuite setup
```

`setup` is interactive and writes two keys to `~/.cgeaa/config`:

| Key | Meaning |
|-----|---------|
| `netsuite_project_dir` | Absolute path to your SDF project root (the folder containing `suitecloud.config.js`) |
| `netsuite_production_auth_id` | Which suitecloud auth ID is **production** (drives the production guard) |
| `netsuite_run_tests` | Optional. Set to `false` to skip the SuiteCloud Jest suite on deploy. Unset or any other value → tests run (default). See "Skipping the Jest suite" below. |

The flow:
1. Prompts for the project directory and validates that `suitecloud.config.js` exists there.
2. Lists your configured suitecloud auth IDs (`suitecloud account:manageauth --list`). If none
   exist, it launches `suitecloud account:setup` for you, then re-checks.
3. Asks which auth ID is production and validates your answer against the list.

NDF fails fast with a "run `cgeaa netsuite setup`" message if either config key is missing when you
run any other command.

> The production auth ID is **not hardcoded** — it is per-developer config, so this works for any
> team member's NetSuite account/role naming.

## Commands

### `cgeaa netsuite envs`
Lists all configured suitecloud auth IDs. Marks the currently active one (from `project.json`'s
`defaultAuthId`) with `*` and the production one with `[PROD]`:

```
  CG-intQA
  CG-UAT
* CG-Production  [PROD]
```

### `cgeaa netsuite switch <authId>`
Sets `defaultAuthId` in `project.json` to `<authId>`, preserving all other fields in that file.

**Production guard:** switching *to* the production auth ID is blocked unless the SDF project's git
branch is `main`. This prevents the "switch to prod, then deploy from a feature branch" bypass.

### `cgeaa netsuite build [--dry-run]`
The core command. Generates feature-scoped deployment files:

1. Computes the diff base: `git merge-base main HEAD` (in the project repo).
2. Runs `git diff <merge-base>..HEAD --name-only --relative` and filters to:
   - **scripts** — `src/FileCabinet/SuiteScripts/*` (excluding `node_modules/`, `.attributes`, `.eslintrc.json`)
   - **objects** — `src/Objects/*.xml`
3. If nothing relevant changed, warns and exits `0` (no empty files written).
4. Writes `src/deploy.xml` with **targeted paths** instead of the wildcard defaults:
   - `<configuration>~/AccountConfiguration/*</configuration>` is always included
   - `<files>` lists only changed scripts; omitted entirely when none changed
   - `<objects>` lists only changed object XML; omitted entirely when none changed
5. Writes `src/manifest.xml`, preserving the existing `<features>` and `<files>` (bundle
   dependency) sections **verbatim**, and initially setting `<objects>` with only this feature's object IDs.
6. Runs `suitecloud project:adddependencies`, which **replaces** the entire `<objects>` section in `manifest.xml` with the full computed dependency set for the current project scope. This recomputation is necessary for deploy to resolve all dependencies — the initial feature-scoped `<objects>` list is superseded by SDF's analysis.

`--dry-run` prints both generated files to stdout and writes nothing (does not run adddependencies).

> **Commit the generated `deploy.xml` / `manifest.xml`** to your feature branch. The branch becomes
> a complete, auditable deployment unit and the PR diff shows exactly what will deploy.

### `cgeaa netsuite deploy --target <authId> [--source <authId>] [--auto-import] [--dry-run] [--skip-tests] [--max-import-rounds <n>]`

Resolves missing object dependencies during deploy and optionally auto-imports them from a source environment.

**Surface:**
- `--target <authId>` (required): the environment to deploy to. Must be a configured auth ID.
- `--source <authId>`: the environment to import missing objects from. Required if deploy fails with unresolved dependencies and you want to resolve them. If provided, enables the auto-import resolve loop.
- `--auto-import`: confirms and auto-imports missing objects without interactive prompt (for CI/GitHub Actions). Without this flag in non-interactive contexts, deploy fails with the list of missing objects.
- `--dry-run`: runs `project:validate` (no deploy, no import).
- `--skip-tests`: skip the SuiteCloud Jest hook (requires project's `suitecloud.config.js` to gate the hook on `NDF_SKIP_TESTS` env var).
- `--max-import-rounds <n>`: cap on dependency resolution retries (default 10). Each round: build → parse missing objects → import only named objects from `--source` → rebuild → retry deploy.

**Account model:**
NDF manages the `project.json` `defaultAuthId` to orchestrate `suitecloud` commands that have no per-command account flag:
1. Sets `defaultAuthId` to `--source` (if provided) for `object:import`.
2. Sets `defaultAuthId` to `--target` for `adddependencies`, `validate`, and `deploy`.
3. Restores the original `defaultAuthId` on success or failure (via `finally` block).

**Production guard:**
The production guard applies to `--target`. Deploy is blocked if `--target` is the production auth ID and you are not on `main`. Error message: `Cannot deploy to production outside of main. Current branch: <branch>. Merge your changes to main first.`

**Dependency resolution loop:**
1. `build` runs `suitecloud project:adddependencies` to populate the manifest; this **replaces** the entire `<objects>` section with the dependency set SDF computes (not additive).
2. Deploy to `--target`; on a missing-object dependency error, parse the SDF-named object IDs (e.g. `customscript_1234`).
3. If objects are found and `--source` is configured:
   - Interactive (TTY): prompt for confirmation before importing.
   - Non-interactive (CI): require `--auto-import`, else fail with the named list.
4. Import only the named objects from `--source` via `suitecloud object:import`.
5. Rebuild (run adddependencies again).
6. Retry the deploy; if it still fails with a different missing object, loop (capped at `--max-import-rounds`, default 10).

**Imported objects:**
The imported object XML files are left in the working tree (under `src/Objects/`) for the developer to review and commit. NDF never auto-commits. Deploy output writes `deploy.xml` and `manifest.xml`; commit them on the feature branch so CI deploys the exact scope.

**Gating:**
Named-only import: if SDF names a missing object ID during resolution, only that object is imported (not a broader set). This minimizes scope creep.

**GitHub Actions example (illustrative — not yet wired):**
```yaml
- name: Deploy feature to UAT (auto-resolve deps)
  run: ./cgeaa netsuite deploy --target CG-UAT --source CG-intQA --auto-import
```

> **NDF is not currently invoked by any CI/CD pipeline.** This snippet shows how an Action *would*
> call NDF; no committed workflow runs it today. See [TODO.md](TODO.md) "CI/CD Roadmap" (and its
> `--base` prerequisite) for the plan to wire this up and retire the existing scripts-only
> `file:upload` workflow.

By default the SuiteCloud `beforeExecuting` Jest hook configured in the project's
`suitecloud.config.js` runs as part of the deploy. To skip it, see below.

### Skipping the Jest suite

`suitecloud` has no CLI flag to bypass its config hook, so skipping the Jest suite is a
**two-part** mechanism:

1. **NDF** sets the environment variable `NDF_SKIP_TESTS=true` on the `suitecloud` subprocess when
   tests are configured off — either persistently via `netsuite_run_tests=false` in `~/.cgeaa/config`,
   or per-run via `cgeaa netsuite deploy --skip-tests`. When tests are on, NDF explicitly clears
   `NDF_SKIP_TESTS` so a stray shell value can't silently skip them.
2. **The project's `suitecloud.config.js`** must gate its `beforeExecuting` hook on that env var:
   ```js
   beforeExecuting: async args => {
     if (process.env.NDF_SKIP_TESTS === 'true') {
       console.log('NDF_SKIP_TESTS=true — skipping SuiteCloud Jest unit tests for this deploy.');
       return args;
     }
     await SuiteCloudJestUnitTestRunner.run({});
     return args;
   }
   ```
   Without this hook edit, NDF's flag has no effect — the SDF project owns whether the hook honors
   the env var.

Precedence: `--skip-tests` (per-run) OR `netsuite_run_tests=false` (persistent) → skip. Default → run.

> Use with care: skipping tests removes a deploy guardrail. It exists for cases where the suite is
> red for reasons unrelated to your change (e.g. pre-existing failures on the branch) and you need
> to deploy to a **lower** environment. Production deploys are still blocked off `main` regardless.

### `cgeaa netsuite pull object <scriptId>`
`suitecloud object:import --scriptid <scriptId> --type ALL --destinationfolder /Objects`.
Imports a custom object (and, in an ACP, its referenced SuiteScript files) into `src/Objects/`.

### `cgeaa netsuite pull file <path>`
`suitecloud file:import --paths <path>`. Imports a File Cabinet file into the project.

### Troubleshooting

**Object-only changes referencing unreachable dependencies:** If a changed object (e.g., a custom script) references a script or file not included in the deploy scope, SDF will flag it as an unresolved dependency. Include the referenced script in the same change, or ensure it already exists in the target environment. If the reference is from an imported object in the source environment, you may need to import the referenced script as well.

## Feature-branch workflow

```bash
# 1. On your feature branch, make script/object changes in the SDF project
git checkout -b FINT-1234-my-feature

# 2. Point NDF at a lower environment
cgeaa netsuite switch CG-intQA

# 3. Preview what will deploy
cgeaa netsuite build --dry-run

# 4. Generate and commit the deploy scope
cgeaa netsuite build
git add src/deploy.xml src/manifest.xml && git commit -m "build: feature deploy scope"

# 5. Deploy to the lower environment
cgeaa netsuite deploy

# 6. Promote to production by merging to main (NOT by switching + deploying from the branch)
```

## Production safety

- You **cannot** `switch` to the production auth ID unless you are on `main`.
- You **cannot** `deploy` with `--target` set to the production auth ID unless you are on `main`.
- The guard error is: `Cannot deploy/switch to production outside of main. Current branch: <branch>.
  Merge your changes to main first.`

Production deploys are intended to happen from `main` after a reviewed merge — not from a feature
branch.

> **There is currently no working path to deploy to production through NDF.** NDF is not invoked by
> any GitHub Action (merging to `main` deploys nothing), *and* the manual command below is a no-op
> today:
>
> ```bash
> cgeaa netsuite deploy --target CG-Production   # from `main` — currently a NO-OP
> ```
>
> `build` computes its changeset as `git diff $(git merge-base main HEAD)..HEAD`, which is non-empty
> only when `HEAD` is *ahead* of `main` (i.e. on a feature branch — and a feature branch is blocked
> by the production guard for a prod target). Standing on `main` after a merge, `HEAD` *is* `main`,
> so the diff is empty and `build` exits `0` ("nothing changed vs main") before any `suitecloud`
> deploy. Making production reachable requires the **`--base <ref>`** work — deploy a just-merged
> feature from `main` with `--base <pre-merge-SHA>` so the diff is `before..main`. A required
> `--allow-production` opt-in flag is the paired safety item. Both are tracked in
> [TODO.md](TODO.md) under "User Roll-out", ahead of the "CI/CD Roadmap".

## How it fits into CGEAA

`cgeaa netsuite <args>` short-circuits all Salesforce logic and passes every argument to the `ndf`
binary via `cgeaa-lib/netsuite.sh` (the same pattern `cgeaa zuora` uses for ZDF). If the bundled
`ndf/dist/ndf.js` is missing, the dispatcher builds it from source.

## Building after TypeScript changes

```bash
cd ndf && npm install && npm run build   # outputs ndf/dist/ndf.js
npm test                                 # vitest — all tests must pass before committing
```

See [CLAUDE.md](CLAUDE.md) for architecture and [TODO.md](TODO.md) for known limitations and
open work.
