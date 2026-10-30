# CGEAA — Claude Code Context

## What this repo is

CGEAA (CarGurus Enterprise Applications Automation) is a single CLI entry point for three
independent automation systems:

- **Salesforce** — pure bash, no build step, wraps the `sf` CLI for deploy/validate/test/diff
- **Zuora** — TypeScript CLI (`zdf`) bundled in `zdf/`, syncs billing objects to/from a tenant
- **NetSuite** — TypeScript CLI (`ndf`) bundled in `ndf/`, does feature-scoped SDF deploys by
  orchestrating Oracle's `suitecloud` CLI

All three are invoked through the top-level `cgeaa` binary:

```bash
cgeaa deploy -o BRStaging                      # Salesforce
cgeaa zuora pull account <id>                  # Zuora (ZDF)
cgeaa netsuite deploy --target CG-intQA        # NetSuite (NDF)
```

## Repo layout

```
CGEAA/
├── cgeaa                  # Main bash dispatcher
├── cgeaa-setup            # One-time installer
├── cgeaa-uninstall        # Removes global install
├── cgeaa-lib/             # Bash modules (one per command)
│   ├── zuora.sh           # Zuora dispatch — delegates to the zdf binary
│   ├── netsuite.sh        # NetSuite dispatch — delegates to the ndf binary
│   └── *.sh               # Salesforce modules (deploy, validate, test, logs, diff, …)
├── scripts/               # Repo maintenance scripts (e.g. sync-netsuite-skills.sh)
├── skills/                # Claude Code skills shipped with the plugin
│   ├── salesforce/        # Team-authored — teaches the `cgeaa` Salesforce CLI
│   ├── zuora/             # Team-authored — teaches `cgeaa zuora ...` (ZDF)
│   ├── netsuite/          # Team-authored — teaches `cgeaa netsuite ...` (NDF)
│   └── netsuite-*/        # Vendored Oracle SuiteCloud dev skills (see NETSUITE-SKILLS.md)
├── zdf/                   # Zuora Development Framework (TypeScript)
│   ├── CLAUDE.md          # ZDF-specific architecture context — read this for ZDF work
│   ├── README-ZDF.md      # Full user-facing reference (commands, endpoints, limitations)
│   ├── bin/zdf.ts         # CLI entry point
│   ├── src/               # Commands, helpers, api, auth
│   └── package.json
└── ndf/                   # NetSuite Development Framework (TypeScript)
    ├── CLAUDE.md          # NDF-specific architecture context — read this for NDF work
    ├── README-NDF.md      # Full user-facing reference (commands, flags, account model)
    ├── TODO.md            # Dev-flow contract, User Roll-out, CI/CD Roadmap
    ├── bin/ndf.ts         # CLI entry point
    ├── src/               # commands/, helpers/
    └── package.json
```

## How the zuora command works

`cgeaa zuora <args>` short-circuits all Salesforce logic (no org detection, no deployment
directory change) and passes every argument verbatim to the `zdf` binary via
`cgeaa-lib/zuora.sh`. If `zdf` is not on `$PATH`, it falls back to building from
`zdf/` automatically.

## How the netsuite command works

`cgeaa netsuite <args>` short-circuits all Salesforce logic and passes every argument verbatim to
the `ndf` binary via `cgeaa-lib/netsuite.sh` (the same pattern as `cgeaa zuora`). If `ndf` is not on
`$PATH`, it falls back to building from `ndf/` automatically. NDF reads `netsuite_project_dir` /
`netsuite_production_auth_id` from `~/.cgeaa/config` (set via `cgeaa netsuite setup`).

## Building ZDF / NDF after TypeScript changes

```bash
cd zdf && npm install && npm run build   # outputs zdf/dist/zdf.js
npm test                                 # vitest — all tests must pass before committing

cd ndf && npm install && npm run build   # outputs ndf/dist/ndf.js
npm test                                 # vitest — all tests must pass before committing
```

## NetSuite (NDF — full CLI, plus vendored Oracle skills)

NetSuite support has **two layers** on the `feature/netsuite-integration` branch:

1. **NDF — the `cgeaa netsuite` CLI** (`ndf/`): a TypeScript CLI that deploys a feature branch's
   SuiteScripts **and** SDF objects to a target environment, auto-generating `deploy.xml` /
   `manifest.xml` from the git diff. Commands: `setup`, `envs`, `switch`, `build [--dry-run]`,
   `deploy --target <authId> [--source <authId>] [--base <ref>] [--allow-production] [--auto-import]
   [--dry-run] [--skip-tests]`, `pull object|file`. Production is reachable only from `main` with
   `--base <pre-merge-SHA> --allow-production`. See `ndf/README-NDF.md` / `ndf/CLAUDE.md` /
   `ndf/TODO.md`.
2. **Vendored Oracle SuiteCloud *Development* skills** (`skills/netsuite-*`): Oracle's agent skills,
   vendored verbatim from [oracle/netsuite-suitecloud-sdk](https://github.com/oracle/netsuite-suitecloud-sdk)
   at a pinned commit (UPL-1.0), teaching the raw `suitecloud` SDK CLI. The team-authored
   `skills/netsuite/` skill teaches the `cgeaa netsuite` workflow and points to these for authoring depth.

- Vendored-skill provenance, the list, and update instructions: [skills/NETSUITE-SKILLS.md](skills/NETSUITE-SKILLS.md)
  (to refresh: bump `PINNED_SHA` in `scripts/sync-netsuite-skills.sh` and re-run).
- The Business User skills (`netsuite-ai-connector-instructions`, `netsuite-finance-analyst`) are
  intentionally excluded.

## Shipping state

ZDF and NDF both ship on `feature/netsuite-integration`, which is being merged to `main` via pull
request. The matching FinSys CI change (an NDF-driven deploy workflow) lives on the FinSys repo's
`cicd/netsuite` branch.

## Salesforce bash conventions

- All modules in `cgeaa-lib/` are sourced at startup by `cgeaa`
- Logging helpers: `log_info`, `log_error`, `log_success`, `log_warn` (from `utils.sh`)
- Config: two-layer `key=value` files — `~/.cgeaa/config` (global) + `.cgeaa/config` (project)
- No build step — edit bash files and commit directly
