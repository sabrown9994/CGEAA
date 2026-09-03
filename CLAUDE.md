# CGEAA — Claude Code Context

## What this repo is

CGEAA (CarGurus Enterprise Applications Automation) is a single CLI entry point for two
independent automation systems:

- **Salesforce** — pure bash, no build step, wraps the `sf` CLI for deploy/validate/test/diff
- **Zuora** — TypeScript CLI (`zdf`) bundled in `zdf/`, handles billing object sync

Both are invoked through the top-level `cgeaa` binary:

```bash
cgeaa deploy -o BRStaging          # Salesforce
cgeaa zuora pull account <id>      # Zuora
```

## Repo layout

```
CGEAA/
├── cgeaa                  # Main bash dispatcher
├── cgeaa-setup            # One-time installer
├── cgeaa-uninstall        # Removes global install
├── cgeaa-lib/             # Bash modules (one per command)
│   ├── zuora.sh           # Zuora dispatch — delegates to zdf binary
│   └── *.sh               # Salesforce modules (deploy, validate, test, logs, diff, …)
├── scripts/               # Repo maintenance scripts (e.g. sync-netsuite-skills.sh)
├── skills/                # Claude Code skills shipped with the plugin
│   ├── salesforce/        # Team-authored — teaches the `cgeaa` Salesforce CLI
│   ├── zuora/             # Team-authored — teaches `cgeaa zuora ...`
│   └── netsuite-*/        # Vendored Oracle SuiteCloud dev skills (see NETSUITE-SKILLS.md)
└── zdf/                   # Zuora Development Framework (TypeScript)
    ├── CLAUDE.md          # ZDF-specific architecture context — read this for ZDF work
    ├── README-ZDF.md      # Full user-facing reference (commands, endpoints, limitations)
    ├── bin/zdf.ts         # CLI entry point
    ├── src/               # Commands, helpers, api, auth
    ├── package.json
    └── tsconfig.json
```

## How the zuora command works

`cgeaa zuora <args>` short-circuits all Salesforce logic (no org detection, no deployment
directory change) and passes every argument verbatim to the `zdf` binary via
`cgeaa-lib/zuora.sh`. If `zdf` is not on `$PATH`, it falls back to building from
`zdf/` automatically.

## Building ZDF after TypeScript changes

```bash
cd zdf && npm install && npm run build   # outputs zdf/dist/zdf.js
npm test                                 # vitest — all tests must pass before committing
```

## NetSuite (skills-only, in progress)

NetSuite support is being added on the `feature/netsuite-integration` branch. So far this is
**skills only** — there is no `cgeaa netsuite ...` CLI yet. The `skills/netsuite-*` folders are
Oracle's SuiteCloud *Development* agent skills, vendored verbatim from
[oracle/netsuite-suitecloud-sdk](https://github.com/oracle/netsuite-suitecloud-sdk) at a pinned
commit (UPL-1.0). They teach the raw `suitecloud` SDK CLI as Oracle ships it.

- Provenance, the vendored list, and update instructions: [skills/NETSUITE-SKILLS.md](skills/NETSUITE-SKILLS.md)
- To refresh from upstream: bump `PINNED_SHA` in `scripts/sync-netsuite-skills.sh` and re-run it.
- The Business User skills (`netsuite-ai-connector-instructions`, `netsuite-finance-analyst`) are
  intentionally excluded.
- Do **not** merge `feature/netsuite-integration` to `main`.

## Active PR

PR #10 `feature/zuora-integration` → `main`:
https://github.com/sabrown9994/CGEAA/pull/10

## Salesforce bash conventions

- All modules in `cgeaa-lib/` are sourced at startup by `cgeaa`
- Logging helpers: `log_info`, `log_error`, `log_success`, `log_warn` (from `utils.sh`)
- Config: two-layer `key=value` files — `~/.cgeaa/config` (global) + `.cgeaa/config` (project)
- No build step — edit bash files and commit directly
