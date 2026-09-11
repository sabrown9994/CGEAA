# cgeaa netsuite CLI — Design Spec

**Date:** 2026-09-11
**Branch:** feature/netsuite-integration
**Status:** Approved for implementation

---

## Context

CGEAA gains a `cgeaa netsuite` command group that wraps the SuiteCloud Development Framework
(SDF) CLI for NetSuite feature-branch development. Developers work in the FinTech mono-repo
(`cargurus-ea/FinTech.git`) with the SDF project living at `FinTech/NetSuite/`. They need to:

1. Deploy feature-branch changes (scripts + custom objects) through environments
   (intQA → UAT → Production) via SDF's `project:deploy`
2. Migrate UI-authored workflows between environments the same way
3. Switch between environments with a production guard
4. Auto-generate feature-scoped `deploy.xml` and `manifest.xml` from the git diff so PR
   reviewers can see exactly what a deploy will touch

The tool is called **NDF (NetSuite Development Framework)** internally, mirroring the
ZDF/Zuora pattern already in CGEAA.

---

## Architecture

### `ndf/` in CGEAA alongside `zdf/`

A new `ndf/` directory mirrors the `zdf/` structure exactly:

```
ndf/
├── bin/ndf.ts                # thin shim → buildProgram().parseAsync()
├── src/
│   ├── program.ts            # registers all commands
│   ├── commands/
│   │   ├── setup.ts          # first-time / re-run NetSuite config
│   │   ├── envs.ts           # list auth IDs + mark active + flag production
│   │   ├── switch.ts         # set defaultAuthId in project.json
│   │   ├── build.ts          # git diff → generate deploy.xml + manifest.xml
│   │   ├── deploy.ts         # build + suitecloud project:deploy
│   │   └── pull.ts           # suitecloud object:import / file:import
│   └── helpers/
│       ├── project-dir.ts    # resolve + validate netsuite_project_dir from config
│       ├── git.ts            # git diff --name-only from merge-base
│       ├── xml.ts            # deploy.xml + manifest.xml generation
│       └── production-guard.ts  # authId vs. git branch check
├── package.json
└── tsconfig.json
```

**Tech stack:** TypeScript, CJS output, Commander.js, Vitest. Build: `tsup bin/ndf.ts
--format cjs --out-dir dist`. Entry: `dist/ndf.js`.

**Dispatch:** `cgeaa-lib/netsuite.sh` (new) delegates verbatim to the `ndf` binary, falling
back to `cd ndf && npm run build` if not on `$PATH` — identical pattern to `zuora.sh → zdf`.

**No shared code** between NDF and ZDF. The `cgeaa` dispatcher is the only common layer.

### Configuration (per-developer, `~/.cgeaa/config`)

Two required keys:

| Key | Description |
|-----|-------------|
| `netsuite_project_dir` | Absolute path to the SDF project root (e.g. `/Users/dev/FinTech/NetSuite`) |
| `netsuite_production_auth_id` | The suitecloud auth ID that maps to production (e.g. `CG-Production`) |

NDF reads these at startup and exits immediately with `"Run 'cgeaa netsuite setup' to
configure NetSuite."` if either is missing or invalid.

---

## Command surface

```
cgeaa netsuite setup
cgeaa netsuite envs
cgeaa netsuite switch <authId>
cgeaa netsuite build [--dry-run]
cgeaa netsuite deploy [--dry-run]
cgeaa netsuite pull object <scriptId>
cgeaa netsuite pull file <path>
```

---

## Command specifications

### `setup`

Interactive, idempotent. Runs as part of `cgeaa-setup` (skippable) and standalone via
`cgeaa netsuite setup`.

1. Prompt for `netsuite_project_dir`. Validate that `suitecloud.config.js` exists there.
   Save to `~/.cgeaa/config`.
2. Run `suitecloud account:manageauth --list`. Show existing auth IDs.
   - If none exist: walk developer through `suitecloud account:setup` interactively.
3. Prompt "Which auth ID is production?" (required). Save as `netsuite_production_auth_id`
   to `~/.cgeaa/config`.

---

### `envs`

Reads `suitecloud account:manageauth --list` and `project.json` (`defaultAuthId`). Prints
each configured auth ID, marking the currently active one (`*`) and production (`[PROD]`):

```
  CG-intQA      intQA        3595813-sb6.app.netsuite.com
  CG-UAT        UAT          3595813-sb1.app.netsuite.com
* CG-Production Production   [PROD]
```

---

### `switch <authId>`

Writes `defaultAuthId` in `<netsuite_project_dir>/project.json`.

**Production guard:** switching TO `netsuite_production_auth_id` is blocked unless the
current git branch of the FinTech repo is `main`. Error:
```
Cannot switch to production outside of main.
Current branch: <branch>. Merge your changes to main first.
```

---

### `build [--dry-run]`

The core command. Generates feature-scoped `deploy.xml` and `manifest.xml`.

**Step 1 — Compute diff base:**
```bash
git -C <netsuite_project_dir> merge-base main HEAD
```
Use this SHA as the diff base (correct for any branch history, including branches that
have never explicitly merged from main).

**Step 2 — Get changed files:**
```bash
git -C <netsuite_project_dir> diff <merge-base>..HEAD --name-only
```
Filter to two path prefixes:
- `src/FileCabinet/SuiteScripts/` → changed scripts
- `src/Objects/` → changed/added custom object XML files

**Step 3 — Edge case: no changes detected.**
Exit with warning: `"No scripts or objects changed vs. main — nothing to build."` Do not
write empty files.

**Step 4 — Generate `deploy.xml`:**

Targeted file paths instead of wildcards. `<configuration>` is always included.
`<files>` omitted if no scripts changed. `<objects>` omitted if no objects changed.

```xml
<deploy>
    <configuration>
        <path>~/AccountConfiguration/*</path>
    </configuration>
    <files>
        <path>~/FileCabinet/SuiteScripts/changed_script.js</path>
    </files>
    <objects>
        <path>~/Objects/customscript_my_feature.xml</path>
    </objects>
</deploy>
```

Paths are relative to `src/` using the `~/` SDF prefix convention.

**Step 5 — Generate `manifest.xml`:**

Preserve the existing `<features>` and `<files>` (bundle dependencies) sections verbatim
from the current `src/manifest.xml`. Replace the `<objects>` section with only the objects
changed/added in this feature (from the git diff). Object IDs are the filenames of the
changed `src/Objects/*.xml` files, without the `.xml` extension.

```xml
<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>NetSuite</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features><!-- preserved verbatim --></features>
    <objects>
      <object>customscript_my_feature</object>
    </objects>
    <files><!-- preserved verbatim --></files>
  </dependencies>
</manifest>
```

**Step 6 — Write or print:**
- Without `--dry-run`: write `src/deploy.xml` and `src/manifest.xml` in place. Print:
  `"deploy.xml and manifest.xml updated — review and commit them to your feature branch."`
- With `--dry-run`: print both files to stdout. Write nothing.

> **Note:** The `<objects>` section in manifest.xml covers only feature-changed objects.
> If this causes dependency resolution issues in SDF, a future revision can switch to
> scanning all files in `src/Objects/` instead. The flag `--full-manifest` can be added
> at that point without breaking the default.

---

### `deploy [--dry-run]`

1. Runs `build` (or `build --dry-run`).
2. **Production guard** (same logic as `switch`): if active auth ID =
   `netsuite_production_auth_id` and current branch ≠ `main`, block with the same message.
3. Runs:
   ```bash
   suitecloud project:deploy --projectdir <netsuite_project_dir> [--dryrun]
   ```

The `suitecloud.config.js` Jest hook runs automatically as part of suitecloud's
`beforeExecuting`. NDF does not bypass it.

---

### `pull object <scriptId>`

```bash
suitecloud object:import \
  --scriptid <scriptId> \
  --projectdir <netsuite_project_dir> \
  --type ALL \
  --destinationfolder /Objects
```

---

### `pull file <path>`

```bash
suitecloud file:import \
  --paths <path> \
  --projectdir <netsuite_project_dir>
```

---

## Production guard (shared)

Applied to: `switch <production-auth-id>` and `deploy`.

```
if (activeAuthId === netsuite_production_auth_id) AND (current git branch ≠ 'main'):
  exit 1 with:
  "Cannot deploy/switch to production outside of main.
   Current branch: <branch>. Merge your changes to main first."
```

The active auth ID is read from `<netsuite_project_dir>/project.json` (`defaultAuthId`).
The git branch is checked via `git -C <netsuite_project_dir> rev-parse --abbrev-ref HEAD`.

---

## SDF project assumptions

- Project type: `ACCOUNTCUSTOMIZATION` (confirmed from `manifest.xml`)
- suitecloud version: `4.0.0`
- Scripts: `src/FileCabinet/SuiteScripts/*.js`
- Objects: `src/Objects/*.xml`
- Config: `suitecloud.config.js` at project root (has Jest `beforeExecuting` hook)
- Auth: managed via `suitecloud account:manageauth`, active ID in `project.json`

---

## Not in scope (this phase)

- `cgeaa-setup` integration (NDF setup added as a skippable section in the existing
  setup flow; `cgeaa netsuite setup` is the standalone path)
- Workflow-specific import commands (workflow objects are imported via `pull object` like
  any other custom object)
- `--accountspecificvalues` passthrough (defaults to `ERROR` — suitecloud's safe default)
- Object deletion from deploy scope
- Multi-project support (single `netsuite_project_dir` per machine)
