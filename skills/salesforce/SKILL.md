---
name: salesforce
description: >-
  Use when a task involves Salesforce deployment or org operations via the CGEAA `cgeaa` CLI —
  validating or deploying metadata to an org, running Apex tests, generating a package.xml
  manifest, diffing local source against an org (or two orgs), managing Apex debug logs, rolling
  back a feature branch, or listing/opening authenticated orgs. Trigger on mentions of Salesforce
  deploy/validate/test, `cgeaa deploy`, `sf`/`sfdx` org work, package.xml/manifest, Apex tests or
  logs, or promoting metadata between Salesforce sandboxes.
---

# Using CGEAA for Salesforce (`cgeaa <command>`)

CGEAA wraps the Salesforce CLI (`sf`) to automate validate/deploy/test/diff/logs against
authenticated orgs, with a branch-based tagging workflow. Run commands as `cgeaa <command>` (or
`./cgeaa <command>` from the repo root).

## Before running anything

- Confirm the CLI is available: `cgeaa help`. If `cgeaa` isn't found, tell the user to run the
  repo's `./cgeaa-setup` first — this skill does not install it.
- Orgs must be authenticated with the Salesforce CLI (`sf auth web login --alias <name>`). List
  what's available with `cgeaa orgs`. Most commands take `-o <orgAlias>` (auto-detected if omitted).
- Test auto-detection reads the sibling `EA-Salesforce-Mappings` repo; if it's missing CGEAA clones
  it (or falls back to a live coverage query).

## Safety — deploys and rollbacks change shared orgs

Treat `deploy`, `rollback`, and `logs clear` as **shared-state / destructive** actions: confirm the
**target org** with the user before running them, and never deploy to a production or shared staging
org without explicit go-ahead. Default to the safe path first:
- Preview with `--dry-run` and inspect scope with `cgeaa manifest -v` / `cgeaa diff -o <org>`.
- **Validate before deploying:** `cgeaa validate -o <org>` (validation-only, no changes committed).
- `rollback` is disabled on `main`/`master`/`develop` by design; it reverts only the current feature
  branch's changed files to their base-branch version on the target org.

## Common commands

```
cgeaa orgs                       # list authenticated org aliases
cgeaa branch                     # show current branch + deployment tag info
cgeaa manifest [-v] [--dry-run]  # generate package.xml from changed files (inspect scope)
cgeaa diff -o <org>              # local-vs-org diff (also --direction org-to-local|org-to-org --source-org <org>)
cgeaa validate -o <org> [--dry-run]           # validation-only deploy
cgeaa deploy -o <org> [--git-tag] [-t <level>]# deploy; --git-tag tags on success
cgeaa test -o <org> [--list]                  # run Apex tests (auto-detects relevant classes; --list previews, no run)
cgeaa logs list|get|tail|clear -o <org>       # Apex debug logs (get: --log-id / --log-output-dir; tail streams; clear deletes)
cgeaa open -o <org>              # open the org in a browser
cgeaa rollback -o <org>          # revert current feature branch's changes on the org
```

Key options: `-o/--org`, `-t/--test-level` (`NoTestRun`|`RunSpecifiedTests`|`RunLocalTests`|`RunAllTestsInOrg`),
`--tests "A,B"`, `-b/--base-branch`, `-m/--manifest`, `-f/--force`, `-d/--dry-run`, `-v/--verbose`,
`-q/--quiet`, `-i/--interactive`, `-gt/--git-tag`. Exit code `0` = success, `1` = failure.

## Typical feature-branch flow

```
cgeaa manifest -v                # 1. review what will deploy
cgeaa diff -o BRInt              # 2. see how the org differs from local
cgeaa validate -o BRInt          # 3. validate (no changes yet)
cgeaa deploy -o BRInt --git-tag  # 4. deploy to integration + tag (confirm the org first)
cgeaa test -o BRInt              # 5. run auto-detected tests
```

## Full reference

For every command, option, test level, and the coverage-mapping/tagging details, read
`README-CGEAA.md` in the repo.
