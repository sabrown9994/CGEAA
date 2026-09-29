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
   dependency) sections **verbatim**, and replacing `<objects>` with only this feature's object IDs.

`--dry-run` prints both generated files to stdout and writes nothing.

> **Commit the generated `deploy.xml` / `manifest.xml`** to your feature branch. The branch becomes
> a complete, auditable deployment unit and the PR diff shows exactly what will deploy.

### `cgeaa netsuite deploy [--dry-run]`
1. Enforces the production guard on the **currently active** environment (blocks a real deploy when
   the active env is production and you are not on `main`).
2. Runs `build` (respecting `--dry-run`).
3. Runs `suitecloud project:deploy` (adds `--dryrun` when `--dry-run` is set), streaming output.

The SuiteCloud `beforeExecuting` Jest hook configured in the project's `suitecloud.config.js` runs
as part of the deploy — NDF does not bypass it.

### `cgeaa netsuite pull object <scriptId>`
`suitecloud object:import --scriptid <scriptId> --type ALL --destinationfolder /Objects`.
Imports a custom object (and, in an ACP, its referenced SuiteScript files) into `src/Objects/`.

### `cgeaa netsuite pull file <path>`
`suitecloud file:import --paths <path>`. Imports a File Cabinet file into the project.

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
- You **cannot** `deploy` while the active environment is production and you are not on `main`.
- The guard error is: `Cannot deploy/switch to production outside of main. Current branch: <branch>.
  Merge your changes to main first.`

Production deploys are intended to happen from `main` after a reviewed merge — not from a feature
branch.

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
