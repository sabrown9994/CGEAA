# NetSuite SuiteCloud Development Skills — provenance

The `netsuite-*` skill folders in this directory are vendored from Oracle's
SuiteCloud SDK agent-skills collection.

- **Upstream:** https://github.com/oracle/netsuite-suitecloud-sdk
- **Path:** `packages/agent-skills/`
- **Pinned commit:** `03d349ecbed3dd3f1f0557e964268d5d21663e68` (master @ 2026-08-19)
- **License:** Universal Permissive License v1.0 (UPL-1.0) — see
  [NETSUITE-SKILLS-LICENSE.txt](./NETSUITE-SKILLS-LICENSE.txt)
- **Spec:** agentskills.io (Claude Code compatible)

## What we ship

Only the **SuiteCloud Development Skills** section from upstream is vendored.
The Business User skills (`netsuite-ai-connector-instructions`,
`netsuite-finance-analyst`) are intentionally excluded.

| Skill | Purpose |
| --- | --- |
| `netsuite-owasp-secure-coding` | OWASP secure-coding practices with SuiteScript examples |
| `netsuite-sdf-project-documentation` | Generate/maintain enterprise docs for SDF projects |
| `netsuite-sdf-roles-and-permissions` | Generate/review SDF permission configs (customrole XML) |
| `netsuite-sdf-safe-guide` | SDF best practices per the SAFE Guide (14 script types, governance) |
| `netsuite-suitescript-learning` | Interactive SuiteScript learning modes |
| `netsuite-suitescript-records-reference` | Record/field reference across 272 record types |
| `netsuite-suitescript-upgrade` | SuiteScript 1.0/2.0 → 2.1 migration assistant |
| `netsuite-uif-spa-reference` | UIF SPA component API/type lookup (`@uif-js/core`, `@uif-js/component`) |

## Updating

These are vendored copies, not a submodule. To refresh them from upstream,
bump `PINNED_SHA` in [../scripts/sync-netsuite-skills.sh](../scripts/sync-netsuite-skills.sh)
and re-run it:

```bash
./scripts/sync-netsuite-skills.sh
```

The allowlist in that script is the single source of truth for which skills
ship — edit it there, not by adding folders here.
