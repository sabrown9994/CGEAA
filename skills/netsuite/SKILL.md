---
name: netsuite
description: >-
  Use for ANY NetSuite development or customization work in this repo — SuiteScript
  (user event / suitelet / map-reduce / scheduled / restlet / client / portlet scripts,
  SuiteFlow workflows), SDF custom objects (customscript, customrecord, customrole, saved
  searches, custom fields/lists), and deploying those changes between NetSuite environments
  via the CGEAA `cgeaa netsuite ...` CLI (the bundled NetSuite Development Framework, "NDF",
  which wraps Oracle's SuiteCloud SDK). This is the entry point for NetSuite feature work:
  switching environments, building a feature-scoped deploy, deploying with dependency
  auto-resolution, and importing objects/files. It sits alongside the vendored Oracle
  `netsuite-*` skills (SAFE guide, records reference, roles/permissions, SuiteScript
  upgrade, OWASP, UIF SPA) — reach for those for SuiteScript/SDF authoring depth, and this
  one for the CLI workflow. Trigger on: NetSuite, SuiteScript, SuiteCloud, SDF, `cgeaa
  netsuite`, NDF, suitecloud, custom object/record/script, usereventscript/suitelet/
  mapreduce/restlet, workflow (SuiteFlow), vendor bill approval, journal entry, Zip/Brex
  bill-pay, deploy/import NetSuite objects, moving NetSuite customizations between
  IntQA / StagingUAT / Production, or any work in the FinSys / FinTech repo's `NetSuite/`
  SDF project folder (`src/FileCabinet/SuiteScripts`, `src/Objects`).
---

# Using NDF (`cgeaa netsuite`)

NDF is a developer CLI that deploys NetSuite SuiteScript + SDF custom objects from a
feature branch to a target environment, auto-generating the `deploy.xml` / `manifest.xml`
from your git diff and resolving object dependencies. It **orchestrates** Oracle's
`suitecloud` CLI — it does not talk to NetSuite over HTTP. Every command is `cgeaa netsuite <args>`.

The SDF project lives in the FinSys/FinTech repo under `NetSuite/` (`src/FileCabinet/SuiteScripts`,
`src/Objects`, `project.json`, `suitecloud.config.js`). NDF runs from anywhere via a configured
project path.

## Before running anything

- Confirm the CLI: `cgeaa netsuite --help`. If `cgeaa` isn't found, tell the user to run the repo's
  `./cgeaa-setup` (or `cd ndf && npm install && npm run build`) — this skill does **not** install it.
- One-time per machine: `cgeaa netsuite setup` writes `netsuite_project_dir` and
  `netsuite_production_auth_id` to `~/.cgeaa/config`. NDF fails fast telling you to run setup if
  either is missing.
- Requires Oracle's `suitecloud` CLI on `$PATH` and authenticated environments
  (`suitecloud account:manageauth --list`). Environments are auth IDs (e.g. `CG-intQA`, `CG-UAT`,
  `CG-Production`).

## Commands

```
cgeaa netsuite envs                         # list environments; marks active (*) and production [PROD]
cgeaa netsuite switch <authId>              # set the active environment (project.json defaultAuthId)
cgeaa netsuite build [--dry-run]            # generate deploy.xml + manifest.xml from the git diff vs main
cgeaa netsuite deploy --target <authId> [--source <authId>] [--auto-import] [--dry-run] [--skip-tests]
cgeaa netsuite pull object <scriptId>       # import a custom object from NetSuite into src/Objects/
cgeaa netsuite pull file <path>             # import a File Cabinet file
```

## Feature-branch workflow

1. On your feature branch, make SuiteScript / object changes in the SDF project.
2. `cgeaa netsuite build --dry-run` to preview the feature-scoped `deploy.xml` / `manifest.xml`
   (built from `git diff main..HEAD`). `build` writes them; commit them so a PR shows the deploy scope.
3. `cgeaa netsuite deploy --target CG-intQA` to deploy to a lower environment. If a changed
   object/script references a custom object that isn't in the project, the deploy resolves it:
   `project:adddependencies` declares what already exists in the target, and for genuinely-absent
   objects NDF imports **only** the SDF-named ones from `--source` (gated — it confirms
   interactively, or needs `--auto-import` in CI) and retries, capped at 10 rounds. Imported object
   XML is left in your working tree to review/commit.
4. Promote to production by **merging to `main`**, not by deploying from a feature branch.

## Safety

- **Production guard:** `deploy --target <prod>` and `switch <prod>` are blocked unless the SDF
  project's git branch is `main`. Production deploys happen from `main` after a reviewed merge.
- `--skip-tests` skips the SuiteCloud Jest hook (requires the project's `suitecloud.config.js` to gate
  on `NDF_SKIP_TESTS`); otherwise the hook runs on every deploy.
- Always confirm the target with `cgeaa netsuite envs` before deploying.

## SuiteScript / SDF authoring depth

For writing or reviewing the SuiteScript and SDF objects themselves (not the deploy workflow), use
the companion Oracle skills bundled in this repo: `netsuite-sdf-safe-guide` (SDF best practices,
Object XML for all script types, governance), `netsuite-suitescript-records-reference` (record/field
IDs), `netsuite-sdf-roles-and-permissions` (customrole XML, permkey/permlevel),
`netsuite-suitescript-upgrade` (1.0→2.1 migration), `netsuite-owasp-secure-coding`, and
`netsuite-uif-spa-reference`.

## Full reference

For every command, flag, the dependency-resolution loop, and the account model, read
`ndf/README-NDF.md` in the repo.
