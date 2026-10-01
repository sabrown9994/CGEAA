# NDF — Claude Code Context

NDF (NetSuite Development Framework) is a TypeScript CLI that wraps Oracle's SuiteCloud SDK
(`suitecloud`) for feature-branch NetSuite development. It is invoked as `cgeaa netsuite <command>`.
See `README-NDF.md` for the user-facing reference and `TODO.md` for known limitations and open work.

## Tech stack

- TypeScript, CJS output (`"type": "commonjs"`)
- Node16 module resolution — **all internal imports use the `.js` extension** even for `.ts` source
- Commander.js with a `registerX(program)` function per command module
- Vitest — `vi.hoisted(() => vi.fn())` for all mock variables
- Build: `tsup bin/ndf.ts --format cjs --out-dir dist`
- Entry point: `bin/ndf.ts` (thin shim) → `buildProgram()` in `src/program.ts` → `dist/ndf.js`
- Runtime deps: `commander`, `chalk` only. No XML parser — deploy.xml/manifest.xml are built with
  template strings + `indexOf`/`slice` extraction.

## Architecture — NDF shells out to `suitecloud`

NDF does **not** talk to NetSuite over HTTP. Every NetSuite interaction is a `suitecloud`
subprocess call. NDF's job is orchestration: resolve config, compute the git diff, generate the
deploy/manifest XML, enforce the production guard, then hand off to `suitecloud`.

- All `suitecloud` calls run with `cwd: projectDir` (NOT a `--projectdir` flag — that flag does not
  exist on `suitecloud project:deploy`/`object:import`/`file:import`; see TODO.md live findings).
- `deploy`/`pull` use `spawnSync(..., { stdio: 'inherit', cwd })` so suitecloud output streams live.
- `envs`/`setup` use `execSync('suitecloud account:manageauth --list')` because they parse captured
  output.

## Configuration

Two keys in `~/.cgeaa/config` (the shared CGEAA global config, `key=value` per line):

| Key | Meaning |
|-----|---------|
| `netsuite_project_dir` | Absolute path to the SDF project root (contains `suitecloud.config.js`) |
| `netsuite_production_auth_id` | The suitecloud auth ID that is production; never hardcoded |
| `netsuite_run_tests` | Optional. `false` → deploy skips the SuiteCloud Jest hook (via `NDF_SKIP_TESTS`). `getRunTests()` returns `true` unless the value is literally `"false"`. |

`getProjectDir()` throws `NdfConfigError` ("run `cgeaa netsuite setup`") if the key is missing or
`suitecloud.config.js` isn't found at the path. `getProductionAuthId()` throws the same if its key
is missing. Every command catches errors → `output.error(msg)` + `process.exit(1)`.

## Source layout

| File | Purpose |
|------|---------|
| `bin/ndf.ts` | Entry shim — `buildProgram().parseAsync(process.argv)` |
| `src/program.ts` | `buildProgram()` — registers all six commands |
| `src/commands/setup.ts` | Interactive `setup` (readline); writes both config keys |
| `src/commands/envs.ts` | `envs` — lists auth IDs, marks active (`*`) + production (`[PROD]`) |
| `src/commands/switch-env.ts` | `switch <authId>` — writes `project.json` `defaultAuthId` |
| `src/commands/build.ts` | `build [--dry-run]` — thin wrapper over `runBuild` |
| `src/commands/deploy.ts` | `deploy --target <authId> [--source <authId>] [--auto-import] [--dry-run] [--skip-tests] [--max-import-rounds <n>]` — dependency resolution orchestration. Swap `defaultAuthId` to `--source` for `object:import` and `--target` for `adddependencies`/`validate`/`deploy`, restore in `finally`. Resolve loop: build (adddependencies REPLACES manifest), deploy, on missing-object error parse SDF output, import named-only objects from `--source` (gated: confirm locally, `--auto-import` in CI), rebuild, retry — capped at `MAX_ROUNDS` (default 10). Production guard on `--target`. Sets `NDF_SKIP_TESTS=true` via `--skip-tests` or `netsuite_run_tests=false`. |
| `src/commands/pull.ts` | `pull object <scriptId>` / `pull file <path>` |
| `src/helpers/build-runner.ts` | `runBuild(opts)` — shared build logic used by `build` and `deploy` |
| `src/helpers/git.ts` | `getMergeBase`, `getChangedFiles`, `getCurrentBranch` |
| `src/helpers/xml.ts` | `generateDeployXml`, `generateManifestXml`, `objectIdFromPath` |
| `src/helpers/config.ts` | `readCgeaaConfig`, `writeCgeaaConfigKey` |
| `src/helpers/project-dir.ts` | `getProjectDir`, `getProductionAuthId`, `NdfConfigError` |
| `src/helpers/production-guard.ts` | `checkProductionGuard`, `getActiveAuthId`, `ProductionGuardError` |
| `src/helpers/output.ts` | `success/error/info/warn` (chalk; mirrors ZDF) |

## Two production guards — they check different things (do not conflate)

- **`switch`** guards the **target** `authId` (the command argument): block if `authId ===
  productionAuthId` and branch ≠ `main`. This is inline in `switch-env.ts` — NOT `checkProductionGuard`.
- **`deploy`** guards the **currently active** auth ID (from `project.json`): `checkProductionGuard`
  reads `getActiveAuthId(projectDir)` and blocks if it equals production and branch ≠ `main`.

An earlier version wrongly used the current-auth guard for `switch`, which blocked switching *away*
from prod and allowed switching *to* prod from a feature branch. Live intQA caught it (see TODO.md).
Keep these two semantics distinct.

## Dependency resolution (deploy with --source and --auto-import)

**Account model (`defaultAuthId` swap):**
`deploy` swaps `project.json` `defaultAuthId` to enable different auth contexts per SDF command, since `suitecloud` has no per-command account flag:
1. Before any SDF call, save the current `defaultAuthId`.
2. Set `defaultAuthId` to `--source` (if provided) for `object:import` calls — NDF must import from the source environment.
3. Set `defaultAuthId` to `--target` for `project:adddependencies`, `project:validate`, and `project:deploy` — these target the deployment environment.
4. In a `finally` block, restore the original `defaultAuthId` even on failure, so the user's shell state is never corrupted.

**Manifest dependency replacement:**
`project:adddependencies` **replaces** the entire `<objects>` section of `manifest.xml` with the dependency set it computes for the current project scope. This is not additive — the committed/base manifest is recomputed. After a successful build, a shrinking `<objects>` list is expected and means SDF no longer detects those objects as project dependencies.

**Named-only import:**
When SDF surfaces a deploy failure due to missing custom objects, NDF parses the error output to extract object IDs (e.g., `customscript_1234`). Only those named objects are imported from `--source` via `suitecloud object:import`. This minimizes unintended scope creep.

**Gating (confirm local / `--auto-import` in CI):**
- **Interactive (TTY):** prompt the user to confirm before importing, listing the objects by name.
- **Non-interactive (CI):** require the `--auto-import` flag. Without it, fail and output the named list to stderr so the CI log shows what was needed.

**Resolution cap:**
`MAX_ROUNDS` (default 10) prevents infinite loops if an import introduces another missing dependency. Each round: build (adddependencies) → deploy → parse errors → import → rebuild → retry. The cap is generous enough for typical multi-level dependencies but prevents runaway loops on misconfiguration.

## build — the critical path

`runBuild` (`build-runner.ts`):
1. `getMergeBase(projectDir)` → `git merge-base main HEAD`.
2. `getChangedFiles(projectDir, mergeBase)`:
   - **Validates the merge-base is hex** (`/^[0-9a-f]{4,64}$/i`) before interpolating into the
     shell command — do not remove this guard.
   - `git diff <base>..HEAD --name-only --relative`. **`--relative` is load-bearing**: the SDF
     project is a subdirectory of a mono-repo (`FinTech/NetSuite/`), so without it git returns
     `NetSuite/src/...` paths and the `src/...` filters silently match nothing.
   - scripts = `src/FileCabinet/SuiteScripts/*` minus `node_modules/`, `.attributes`, `.eslintrc.json`
   - objects = `src/Objects/*.xml`
3. Empty diff → `output.warn` + `process.exit(0)` (so `deploy` on a no-op branch exits clean and
   never reaches `suitecloud`).
4. `generateDeployXml(scripts, objects)`:
   - `<configuration>~/AccountConfiguration/*</configuration>` always present
   - `<files>`/`<objects>` omitted entirely when their list is empty
   - `src/` → `~/` SDF path prefix conversion
5. `generateManifestXml(existingManifestPath, changedObjectIds)`:
   - reads current `src/manifest.xml`, extracts `<features>...</features>` and `<files>...</files>`
     **verbatim** via `indexOf`/`slice` (interior tags are `<file>`, distinct from `</files>`)
   - regenerates `<objects>` from `changedObjectIds` only (feature-scoped, per the design decision;
     may switch to a full `src/Objects/` scan later if SDF dependency resolution needs it)
   - `projectname`/`frameworkversion` are currently hardcoded to `NetSuite`/`1.0` (see TODO.md)
6. `--dry-run` prints both to stdout and returns without writing.

## SDF project assumptions

- Project type `ACCOUNTCUSTOMIZATION`, `suitecloud` v4.x
- `src/FileCabinet/SuiteScripts/*.js`, `src/Objects/*.xml`, `src/AccountConfiguration/`
- `suitecloud.config.js` at project root (has a Jest `beforeExecuting` deploy hook)
- Active auth ID lives in `project.json` `defaultAuthId`
- The project is a subdirectory of a larger git repo (mono-repo) — hence `--relative`

## Test conventions

```typescript
const mockSpawnSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawnSync: mockSpawnSync, execSync: vi.fn() }));

// command tests build a fresh program and call parseAsync
function makeProgram() { const p = new Command(); p.exitOverride(); registerX(p); return p; }

// process.exit assertion pattern
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
await expect(makeProgram().parseAsync([...])).rejects.toThrow('exit');
```

`vitest.config.ts` sets `clearMocks: true`.

## Required development flow

All non-trivial NDF changes follow a 3-stage review after the implementer: **standard reviewer →
adversarial reviewer (assumes everything is wrong) → live intQA test (with state cleanup)**. See
`TODO.md` for the full contract and the bugs each stage has caught.
