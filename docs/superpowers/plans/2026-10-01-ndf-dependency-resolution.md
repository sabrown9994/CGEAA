# NDF Dependency Auto-Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cgeaa netsuite deploy` auto-resolve missing custom-object dependency failures — declare via SDF's `project:adddependencies`, and for objects genuinely absent from the target, import only the SDF-named objects from a `--source` account (gated), rebuild, and retry, bounded by `MAX_ROUNDS`.

**Architecture:** `deploy` owns an error-driven resolve loop against an explicit `--target`. Because `suitecloud` has no per-command account flag, NDF swaps `project.json` `defaultAuthId` around each suitecloud call (source for imports, target for everything else) and restores it in a `finally`. Imports are named-only (parsed from SDF errors), gated (confirm locally / `--auto-import` in CI), and capped.

**Tech Stack:** TypeScript (CJS, Node16 resolution), Commander.js, chalk, Vitest. NDF shells out to `suitecloud` v4 via `child_process`.

**Spec:** `docs/superpowers/specs/2026-10-01-ndf-dependency-resolution-design.md`

## Global Constraints

- All internal imports use the `.js` extension; `ndf/package.json` is `"type": "commonjs"`.
- Vitest mocks use `vi.hoisted(() => vi.fn())`; command tests build a program via `makeProgram()` with `p.exitOverride()`.
- No new runtime dependencies (only `commander`/`chalk`; `child_process`/`fs`/`readline` are stdlib).
- Commits stage only explicit `ndf/` paths — never `git add -A`.
- `cd ndf && npm run build && npm test` must pass before each commit.
- **Imports are named-only:** NDF imports ONLY object script IDs SDF explicitly names as missing — never a speculative crawl. Unparseable errors → import nothing, surface the raw error.
- Account selection is done by swapping `project.json` `defaultAuthId`; it is ALWAYS restored, including on failure (via `finally`).
- The production guard applies to the effective `--target`, evaluated before any swap or network call.
- `MAX_ROUNDS` default is 10 (overridable via `--max-import-rounds <n>`). There is no object-count cap.
- Live verification runs against intQA only, via the NDF dev flow, on the FinSys `cicd/ndf` branch.

## Review Focus

- **`--target`/`--source` not in the configured auth list (typo):** fail fast with a clear message and do NOT swap `defaultAuthId`. (Task 3 + Task 5)
- **`defaultAuthId` not restored when the loop throws mid-flight:** the original value is restored in a `finally` regardless of success/failure/throw. (Task 3 + Task 5)
- **SDF error text NDF cannot parse into concrete script IDs:** treat the missing set as empty → surface the raw error and stop; never import something unnamed. (Task 2 + Task 5)
- **A named object still "missing" after import (import didn't resolve it):** the loop does not spin forever — `MAX_ROUNDS` trips and fails with what was imported + what's still missing. (Task 5)
- **Non-interactive (CI) run needing an import without `--auto-import`:** fail with the named list; import nothing. (Task 5)

---

## File structure

```
ndf/src/
├── helpers/
│   ├── auth.ts            # NEW: listAuthIds(), validateAuthId(); AccountSwitcher (defaultAuthId swap+restore)
│   ├── dependency-parser.ts  # NEW: parseMissingObjectRefs(output) → string[]
│   ├── suitecloud.ts      # NEW: thin runSuitecloud(args, {cwd, env, capture}) wrapper (spawnSync)
│   ├── build-runner.ts    # MODIFY: runBuild() also runs project:adddependencies
│   └── project-dir.ts     # (unchanged)
└── commands/
    ├── build.ts           # (unchanged surface; runBuild change flows through)
    └── deploy.ts          # REWRITE: --target/--source/--auto-import/--max-import-rounds + resolve loop
```

Rationale: parsing, auth/account-switching, and the suitecloud-invocation wrapper are each isolated, pure-ish units that `deploy` composes. `deploy` holds only the loop orchestration.

---

## Task 1: Spike — verify SDF behaviors on `cicd/ndf` (research, no production code)

**Goal:** Replace the spec's assumptions with observed facts before building the parser/loop. This is a RESEARCH task — it writes a findings file, not shipping code. Requires the FinSys repo on branch `cicd/ndf` (ask the user to confirm/switch first). All intQA state touched must be reverted.

**Report file:** `ndf/docs/sdf-dependency-findings.md` (committed — it documents real SDF behavior for future maintainers).

- [ ] **Step 1: Confirm environment**
Run `git -C /Users/rpinto/Documents/FinSys rev-parse --abbrev-ref HEAD` → must be `cicd/ndf`. If not, STOP and ask the user to switch. Record current `project.json` `defaultAuthId` to restore later.

- [ ] **Step 2: `project:adddependencies` account need + output**
From `/Users/rpinto/Documents/FinSys/NetSuite`, run `suitecloud project:adddependencies` and observe: does it require/use the account connection? Does it modify `manifest.xml`, and does it ADD to the existing `<dependencies><objects>` or require them empty? Capture a before/after diff of `manifest.xml`. Then `git checkout -- src/manifest.xml` to restore.

- [ ] **Step 3: Capture exact missing-dependency error text**
Recreate the known failure: on `cicd/ndf`, temporarily set an object to reference a non-existent record (e.g. `customscript_cg_boa_checkpay.xml` `<recordtype>[scriptid=customrecord_ndf_missing_test]</recordtype>`), commit to a scratch commit, `node /Users/rpinto/Documents/CGEAA/ndf/dist/ndf.js build`, then `NDF_SKIP_TESTS=true suitecloud project:deploy` (active env a sandbox, e.g. CG-intQA). Record the VERBATIM error line(s) naming the missing object. Then revert the scratch commit and restore `deploy.xml`/`manifest.xml`.

- [ ] **Step 4: `project:validate` parity**
Run `suitecloud project:validate --server` on the same failing state and record whether it reports the same missing-object line(s) as `project:deploy` (needed for `--dry-run` preview). Revert.

- [ ] **Step 5: Single-object import**
Pick a real object present in a source sandbox but imaginably absent elsewhere; run `suitecloud object:import --scriptid <id> --type ALL --destinationfolder /Objects` and confirm it imports exactly that object. Delete the imported file afterward (`git status` → remove any new file) to restore the project.

- [ ] **Step 6: Restore + write findings**
Confirm `git -C /Users/rpinto/Documents/FinSys status --short` shows only the pre-existing `suitecloud.config.js` (or clean). Restore `project.json` `defaultAuthId`. Write `ndf/docs/sdf-dependency-findings.md` with: the verbatim error regex to use, adddependencies behavior (account need; adds-to vs needs-empty `<objects>`), validate parity (yes/no), and the confirmed `object:import` invocation.

- [ ] **Step 7: Commit the findings**
```bash
cd /Users/rpinto/Documents/CGEAA
git add ndf/docs/sdf-dependency-findings.md
git commit -m "docs(ndf): record SDF dependency-resolution behavior findings (spike)"
```

**Downstream tasks consume this file:** Task 2's regex and Task 4/5's adddependencies+validate handling use the findings. If a finding contradicts the spec, note it in the report and the controller rules on the adjustment before the affected task.

---

## Task 2: `parseMissingObjectRefs` — dependency error parser

**Files:**
- Create: `ndf/src/helpers/dependency-parser.ts`
- Test: `ndf/src/__tests__/helpers/dependency-parser.test.ts`

**Interfaces:**
- Consumes: the verbatim error phrasing from Task 1's findings.
- Produces: `export function parseMissingObjectRefs(output: string): string[]` — deduped list of missing object script IDs; `[]` when nothing matches.

- [ ] **Step 1: Write failing tests**

`ndf/src/__tests__/helpers/dependency-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseMissingObjectRefs } from '../../helpers/dependency-parser.js';

const MISSING_ONE =
  'Validation of account settings failed.\n' +
  'The object reference [scriptid=customrecord_ndf_missing_test] is missing in the project and also not included in the dependencies list.';

const MISSING_TWO =
  'The object reference [scriptid=customrecord_a] is missing in the project and also not included in the dependencies list.\n' +
  'The object reference [scriptid=customlist_b] is missing in the project and also not included in the dependencies list.';

describe('parseMissingObjectRefs', () => {
  it('extracts a single missing object script id', () => {
    expect(parseMissingObjectRefs(MISSING_ONE)).toEqual(['customrecord_ndf_missing_test']);
  });

  it('extracts and dedupes multiple missing ids', () => {
    expect(parseMissingObjectRefs(MISSING_TWO)).toEqual(['customrecord_a', 'customlist_b']);
  });

  it('dedupes a repeated id', () => {
    const twice = MISSING_ONE + '\n' + MISSING_ONE;
    expect(parseMissingObjectRefs(twice)).toEqual(['customrecord_ndf_missing_test']);
  });

  it('returns empty array when no missing-object line is present', () => {
    expect(parseMissingObjectRefs('Some other error: deployment failed.')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(parseMissingObjectRefs('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**
```bash
cd /Users/rpinto/Documents/CGEAA/ndf && npm test -- dependency-parser
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `dependency-parser.ts`**

```typescript
// Matches SDF's missing-object-reference line, e.g.:
//   The object reference [scriptid=customrecord_foo] is missing in the project
//   and also not included in the dependencies list.
// Verbatim phrasing confirmed in ndf/docs/sdf-dependency-findings.md (Task 1).
const MISSING_REF_RE = /\[scriptid=([a-z0-9_]+)\]\s+is missing in the project/gi;

export function parseMissingObjectRefs(output: string): string[] {
  const ids = new Set<string>();
  for (const m of output.matchAll(MISSING_REF_RE)) {
    ids.add(m[1]);
  }
  return [...ids];
}
```
> If Task 1's findings show different phrasing, adjust `MISSING_REF_RE` and the test fixtures to the verbatim text before implementing.

- [ ] **Step 4: Run test — confirm pass**
```bash
npm test -- dependency-parser
```

- [ ] **Step 5: Build + commit**
```bash
npm run build
cd /Users/rpinto/Documents/CGEAA
git add ndf/src/helpers/dependency-parser.ts ndf/src/__tests__/helpers/dependency-parser.test.ts
git commit -m "feat(ndf): add parseMissingObjectRefs dependency-error parser"
```

---

## Task 3: suitecloud invocation wrapper + auth/account helpers

**Files:**
- Create: `ndf/src/helpers/suitecloud.ts`
- Create: `ndf/src/helpers/auth.ts`
- Test: `ndf/src/__tests__/helpers/auth.test.ts`

**Interfaces:**
- Consumes: `getActiveAuthId` from `production-guard.js` (reads `project.json` `defaultAuthId`).
- Produces:
  - `suitecloud.ts`: `export interface SuitecloudResult { status: number; output: string }` and
    `export function runSuitecloud(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): SuitecloudResult` — runs `suitecloud` via `spawnSync` with `stdio: 'pipe'`, `encoding: 'utf-8'`; `output` is stdout+stderr concatenated; the caller is responsible for echoing `output`.
  - `auth.ts`: `export function listAuthIds(projectDir: string): string[]`,
    `export function validateAuthId(projectDir: string, authId: string): void` (throws `Error` naming the bad id + the valid list),
    `export function setDefaultAuthId(projectDir: string, authId: string): void` (writes `project.json` preserving other keys, tab-indented).

- [ ] **Step 1: Implement `suitecloud.ts`** (no standalone unit test — exercised via command tests that mock it)

```typescript
import { spawnSync } from 'child_process';

export interface SuitecloudResult {
  status: number;
  output: string;
}

export function runSuitecloud(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): SuitecloudResult {
  const res = spawnSync('suitecloud', args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf-8',
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { status: res.status ?? 1, output };
}
```

- [ ] **Step 2: Write failing tests for `auth.ts`**

`ndf/src/__tests__/helpers/auth.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync }));

import { listAuthIds, validateAuthId, setDefaultAuthId } from '../../helpers/auth.js';

const AUTH_LIST =
  'CG-intQA | Administrator @ CarGurus - intQA | 3595813-sb6.app.netsuite.com\n' +
  'CG-UAT | Administrator @ CarGurus - StagingUAT | 3595813-sb1.app.netsuite.com\n' +
  'CG-Production | Administrator @ CarGurus\n';

beforeEach(() => {
  mockExecSync.mockReturnValue(Buffer.from(AUTH_LIST));
});

describe('listAuthIds', () => {
  it('parses auth ids from manageauth --list (ANSI stripped, first pipe field)', () => {
    expect(listAuthIds('/proj')).toEqual(['CG-intQA', 'CG-UAT', 'CG-Production']);
    expect(mockExecSync).toHaveBeenCalledWith('suitecloud account:manageauth --list', { cwd: '/proj' });
  });
});

describe('validateAuthId', () => {
  it('does not throw for a known auth id', () => {
    expect(() => validateAuthId('/proj', 'CG-UAT')).not.toThrow();
  });
  it('throws for an unknown auth id, naming it', () => {
    expect(() => validateAuthId('/proj', 'CG-Typo')).toThrow(/CG-Typo/);
  });
});

describe('setDefaultAuthId', () => {
  it('writes defaultAuthId preserving other keys, tab-indented', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-intQA', other: 'x' }));
    setDefaultAuthId('/proj', 'CG-UAT');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('project.json'),
      JSON.stringify({ defaultAuthId: 'CG-UAT', other: 'x' }, null, '\t'),
      'utf-8',
    );
  });
});
```

- [ ] **Step 3: Run — confirm fail**
```bash
cd /Users/rpinto/Documents/CGEAA/ndf && npm test -- auth
```

- [ ] **Step 4: Implement `auth.ts`**

```typescript
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function listAuthIds(projectDir: string): string[] {
  const raw = execSync('suitecloud account:manageauth --list', { cwd: projectDir }).toString();
  return raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split('|')[0].trim()).filter(Boolean);
}

export function validateAuthId(projectDir: string, authId: string): void {
  const ids = listAuthIds(projectDir);
  if (!ids.includes(authId)) {
    throw new Error(
      `Unknown auth ID "${authId}". Configured auth IDs: ${ids.join(', ') || '(none)'}. ` +
      `Run 'cgeaa netsuite envs' to list them.`,
    );
  }
}

export function setDefaultAuthId(projectDir: string, authId: string): void {
  const path = join(projectDir, 'project.json');
  const current = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  current['defaultAuthId'] = authId;
  writeFileSync(path, JSON.stringify(current, null, '\t'), 'utf-8');
}
```

- [ ] **Step 5: Run — confirm pass; build**
```bash
npm test -- auth && npm run build
```

- [ ] **Step 6: Commit**
```bash
cd /Users/rpinto/Documents/CGEAA
git add ndf/src/helpers/suitecloud.ts ndf/src/helpers/auth.ts ndf/src/__tests__/helpers/auth.test.ts
git commit -m "feat(ndf): add suitecloud wrapper and auth/account-switch helpers"
```

---

## Task 4: `build` runs `project:adddependencies`

**Files:**
- Modify: `ndf/src/helpers/build-runner.ts`
- Test: `ndf/src/__tests__/commands/build.test.ts` (extend)

**Interfaces:**
- Consumes: `runSuitecloud` from `suitecloud.js`.
- Produces: unchanged `runBuild(opts: BuildOptions): Promise<void>` signature; after writing `deploy.xml`/`manifest.xml` it runs `suitecloud project:adddependencies` (skipped under `dryRun`).

**Context:** Per the spec, `adddependencies` populates the manifest `<dependencies>` from what the project references, superseding NDF's hand-rolled `<objects>` list. Keep `generateManifestXml` as the base-manifest writer (features/files preserved); `adddependencies` augments it in place after write. Verify adddependencies' add-to-vs-empty behavior against Task 1 findings; if it requires an empty `<objects>`, change `generateManifestXml` call to pass `[]` for object ids — note this in the fix if the spike shows it.

- [ ] **Step 1: Write failing test (extend build.test.ts)**

Add to `ndf/src/__tests__/commands/build.test.ts` (which already mocks `build-runner` for the command; here we add a test of `runBuild` itself OR assert build-runner calls adddependencies). Create a focused test file `ndf/src/__tests__/helpers/build-runner.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';

const mockGetMergeBase = vi.hoisted(() => vi.fn());
const mockGetChangedFiles = vi.hoisted(() => vi.fn());
const mockGenerateDeployXml = vi.hoisted(() => vi.fn());
const mockGenerateManifestXml = vi.hoisted(() => vi.fn());
const mockObjectIdFromPath = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockRunSuitecloud = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/git.js', () => ({ getMergeBase: mockGetMergeBase, getChangedFiles: mockGetChangedFiles }));
vi.mock('../../helpers/xml.js', () => ({
  generateDeployXml: mockGenerateDeployXml,
  generateManifestXml: mockGenerateManifestXml,
  objectIdFromPath: mockObjectIdFromPath,
}));
vi.mock('fs', () => ({ writeFileSync: mockWriteFileSync }));
vi.mock('../../helpers/suitecloud.js', () => ({ runSuitecloud: mockRunSuitecloud }));

import { runBuild } from '../../helpers/build-runner.js';

beforeEach(() => {
  mockGetMergeBase.mockReturnValue('abc123');
  mockGetChangedFiles.mockReturnValue({ scripts: ['src/FileCabinet/SuiteScripts/foo.js'], objects: [] });
  mockObjectIdFromPath.mockImplementation((p: string) => p);
  mockGenerateDeployXml.mockReturnValue('<deploy/>');
  mockGenerateManifestXml.mockReturnValue('<manifest/>');
  mockRunSuitecloud.mockReturnValue({ status: 0, output: '' });
});

describe('runBuild adddependencies', () => {
  it('runs project:adddependencies after writing files (non-dry-run)', async () => {
    await runBuild({ projectDir: '/proj', dryRun: false });
    expect(mockRunSuitecloud).toHaveBeenCalledWith(['project:adddependencies'], { cwd: '/proj' });
  });

  it('does NOT run adddependencies on dry-run', async () => {
    await runBuild({ projectDir: '/proj', dryRun: true });
    expect(mockRunSuitecloud).not.toHaveBeenCalled();
  });

  it('throws if adddependencies fails', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'boom' });
    await expect(runBuild({ projectDir: '/proj', dryRun: false })).rejects.toThrow(/adddependencies/);
  });
});
```

- [ ] **Step 2: Run — confirm fail**
```bash
cd /Users/rpinto/Documents/CGEAA/ndf && npm test -- build-runner
```

- [ ] **Step 3: Modify `build-runner.ts`** — after the two `writeFileSync` calls (non-dry-run branch), add:
```typescript
import { runSuitecloud } from './suitecloud.js';
// ...after writeFileSync(deploy.xml) and writeFileSync(manifest.xml):
const dep = runSuitecloud(['project:adddependencies'], { cwd: projectDir });
if (dep.status !== 0) {
  throw new Error(`project:adddependencies failed:\n${dep.output}`);
}
```
Keep the existing early `return` for `dryRun` BEFORE the writes (so adddependencies is naturally skipped on dry-run). Keep the "nothing to build" `process.exit(0)` path unchanged.

- [ ] **Step 4: Run — confirm pass; full suite; build**
```bash
npm test && npm run build
```

- [ ] **Step 5: Commit**
```bash
cd /Users/rpinto/Documents/CGEAA
git add ndf/src/helpers/build-runner.ts ndf/src/__tests__/helpers/build-runner.test.ts
git commit -m "feat(ndf): build runs project:adddependencies to populate manifest deps"
```

---

## Task 5: `runBuild` accepts imported object paths

**Files:**
- Modify: `ndf/src/helpers/build-runner.ts`
- Test: `ndf/src/__tests__/helpers/build-runner.test.ts` (extend)

**Why:** imported objects land as NEW files under `src/Objects/` that are NOT in the git diff, so `getChangedFiles` won't include them. The deploy loop must union them into the deploy scope, or the just-imported object won't be deployed and the dependency stays missing (infinite-round risk). `runBuild` gains an `extraObjectPaths` input.

**Interfaces:**
- Produces: `export interface BuildOptions { projectDir: string; dryRun: boolean; extraObjectPaths?: string[] }` and `runBuild` unions `extraObjectPaths` (deduped) into the objects passed to `generateDeployXml`.

- [ ] **Step 1: Write failing test (extend build-runner.test.ts)**
```typescript
it('includes extraObjectPaths in the deploy.xml object list (deduped)', async () => {
  mockGetChangedFiles.mockReturnValue({
    scripts: [],
    objects: ['src/Objects/customscript_a.xml'],
  });
  await runBuild({
    projectDir: '/proj',
    dryRun: false,
    extraObjectPaths: ['src/Objects/customrecord_x.xml', 'src/Objects/customscript_a.xml'],
  });
  // generateDeployXml receives the union, deduped, preserving diff objects first
  expect(mockGenerateDeployXml).toHaveBeenCalledWith(
    [],
    ['src/Objects/customscript_a.xml', 'src/Objects/customrecord_x.xml'],
  );
});

it('builds when only extraObjectPaths are present (no diff changes)', async () => {
  mockGetChangedFiles.mockReturnValue({ scripts: [], objects: [] });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
  // should NOT exit 0 "nothing to build" because an extra object is present
  await runBuild({ projectDir: '/proj', dryRun: false, extraObjectPaths: ['src/Objects/customrecord_x.xml'] });
  expect(exitSpy).not.toHaveBeenCalled();
  exitSpy.mockRestore();
});
```

- [ ] **Step 2: Run — confirm fail**
```bash
cd /Users/rpinto/Documents/CGEAA/ndf && npm test -- build-runner
```

- [ ] **Step 3: Modify `build-runner.ts`** — add `extraObjectPaths?: string[]` to `BuildOptions`; after `getChangedFiles`:
```typescript
const extra = opts.extraObjectPaths ?? [];
const objects = [...changed.objects, ...extra.filter((p) => !changed.objects.includes(p))];
// use `objects` (not changed.objects) for the empty-check and generateDeployXml:
if (scripts.length === 0 && objects.length === 0) { output.warn('No scripts or objects changed vs main — nothing to build.'); process.exit(0); }
const deployXml = generateDeployXml(scripts, objects);
```
(Keep `scripts` from `changed.scripts`. The `objectIdFromPath`/manifest handling stays — remember Task 4 made `adddependencies` populate manifest deps; `generateManifestXml` still writes the base manifest.)

- [ ] **Step 4: Run — confirm pass; full suite; build**
```bash
npm test && npm run build
```

- [ ] **Step 5: Commit**
```bash
cd /Users/rpinto/Documents/CGEAA
git add ndf/src/helpers/build-runner.ts ndf/src/__tests__/helpers/build-runner.test.ts
git commit -m "feat(ndf): runBuild unions imported object paths into deploy scope"
```

---

## Task 6: `deploy` resolution loop (rewrite)

**Files:**
- Rewrite: `ndf/src/commands/deploy.ts`
- Rewrite/extend: `ndf/src/__tests__/commands/deploy.test.ts`

**Interfaces:**
- Consumes: `getProjectDir`, `getProductionAuthId`, `getRunTests` (`project-dir.js`); `getActiveAuthId`, `ProductionGuardError` (`production-guard.js`); `getCurrentBranch` (`git.js`); `validateAuthId`, `setDefaultAuthId` (`auth.js`); `runSuitecloud` (`suitecloud.js`); `parseMissingObjectRefs` (`dependency-parser.js`); `runBuild` (`build-runner.js`); `output`.
- Produces: `registerDeploy(program)` with `--target` (required), `--source`, `--auto-import`, `--dry-run`, `--skip-tests`, `--max-import-rounds` (default `'10'`).

**Behavior (from spec):**
- Validate `--target` (and `--source` if given) against the auth list up front.
- Production guard on `--target` (block if target is production and branch ≠ `main`) — before any swap.
- Remember the original `defaultAuthId`; restore it in `finally` (before any `process.exit`).
- Loop: build (writes files + adddependencies against target) → `project:deploy` (or `project:validate --server` under `--dry-run`) → on success break → else parse missing refs → empty ⇒ surface raw error & fail → round ≥ max ⇒ fail → `--dry-run` ⇒ print "would import" & stop → else gate the import (TTY confirm / CI `--auto-import`) → `object:import` named refs from source → `runBuild` with the imported object paths → retry.
- `--dry-run` DOES write `deploy.xml`/`manifest.xml` locally (so `validate` reflects the feature scope) but never deploys or imports.

- [ ] **Step 1: Write failing tests** — replace `deploy.test.ts` with coverage of the loop and all Review Focus items:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockGetRunTests = vi.hoisted(() => vi.fn());
const mockGetActiveAuthId = vi.hoisted(() => vi.fn());
const mockGetCurrentBranch = vi.hoisted(() => vi.fn());
const mockValidateAuthId = vi.hoisted(() => vi.fn());
const mockSetDefaultAuthId = vi.hoisted(() => vi.fn());
const mockRunSuitecloud = vi.hoisted(() => vi.fn());
const mockParseMissing = vi.hoisted(() => vi.fn());
const mockRunBuild = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId, getRunTests: mockGetRunTests,
}));
vi.mock('../../helpers/production-guard.js', () => ({
  getActiveAuthId: mockGetActiveAuthId,
  ProductionGuardError: class ProductionGuardError extends Error {},
}));
vi.mock('../../helpers/git.js', () => ({ getCurrentBranch: mockGetCurrentBranch }));
vi.mock('../../helpers/auth.js', () => ({ validateAuthId: mockValidateAuthId, setDefaultAuthId: mockSetDefaultAuthId }));
vi.mock('../../helpers/suitecloud.js', () => ({ runSuitecloud: mockRunSuitecloud }));
vi.mock('../../helpers/dependency-parser.js', () => ({ parseMissingObjectRefs: mockParseMissing }));
vi.mock('../../helpers/build-runner.js', () => ({ runBuild: mockRunBuild }));

import { registerDeploy } from '../../commands/deploy.js';

function makeProgram() { const p = new Command(); p.exitOverride(); registerDeploy(p); return p; }

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Production');
  mockGetRunTests.mockReturnValue(true);
  mockGetActiveAuthId.mockReturnValue('CG-intQA');
  mockGetCurrentBranch.mockReturnValue('feature/x');
  mockValidateAuthId.mockImplementation(() => {});
  mockSetDefaultAuthId.mockImplementation(() => {});
  mockRunBuild.mockResolvedValue(undefined);
  mockRunSuitecloud.mockReturnValue({ status: 0, output: 'SUCCESS' });
  mockParseMissing.mockReturnValue([]);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  // default: non-interactive (CI) unless a test sets isTTY
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

describe('deploy happy path', () => {
  it('deploys to --target on first success and restores defaultAuthId', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT']);
    expect(mockValidateAuthId).toHaveBeenCalledWith('/proj', 'CG-UAT');
    expect(mockSetDefaultAuthId).toHaveBeenCalledWith('/proj', 'CG-UAT');   // swapped to target
    expect(mockRunSuitecloud).toHaveBeenCalledWith(['project:deploy'], expect.objectContaining({ cwd: '/proj' }));
    expect(mockSetDefaultAuthId).toHaveBeenLastCalledWith('/proj', 'CG-intQA'); // restored
  });
});

describe('production guard on --target', () => {
  it('blocks deploying to production off main (exit 1), no swap', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-Production']))
      .rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockRunSuitecloud).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('unknown target (typo)', () => {
  it('fails fast and never swaps defaultAuthId', async () => {
    mockValidateAuthId.mockImplementation((_d: string, id: string) => { if (id === 'CG-Typo') throw new Error('Unknown auth ID "CG-Typo".'); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-Typo'])).rejects.toThrow('exit');
    expect(mockSetDefaultAuthId).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('unparseable failure', () => {
  it('fails and surfaces raw error without importing', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'some other failure' });
    mockParseMissing.mockReturnValue([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT'])).rejects.toThrow('exit');
    // only deploy attempted; no object:import
    expect(mockRunSuitecloud).toHaveBeenCalledTimes(1);
    expect(mockSetDefaultAuthId).toHaveBeenLastCalledWith('/proj', 'CG-intQA'); // restored even on failure
    exitSpy.mockRestore();
  });
});

describe('CI needs import without --auto-import', () => {
  it('fails with the named list and imports nothing', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'missing' });
    mockParseMissing.mockReturnValue(['customrecord_x']);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA']))
      .rejects.toThrow('exit');
    // no object:import call (only the single deploy attempt)
    const importCalls = mockRunSuitecloud.mock.calls.filter((c) => (c[0] as string[])[0] === 'object:import');
    expect(importCalls.length).toBe(0);
    exitSpy.mockRestore();
  });
});

describe('CI auto-import then success', () => {
  it('imports named objects from --source, rebuilds, retries, succeeds', async () => {
    mockRunSuitecloud
      .mockReturnValueOnce({ status: 1, output: 'missing customrecord_x' })  // deploy #1 fails
      .mockReturnValueOnce({ status: 0, output: 'imported' })                 // object:import
      .mockReturnValueOnce({ status: 0, output: 'SUCCESS' });                 // deploy #2 ok
    mockParseMissing.mockReturnValueOnce(['customrecord_x']).mockReturnValue([]);
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA', '--auto-import']);
    const importCall = mockRunSuitecloud.mock.calls.find((c) => (c[0] as string[])[0] === 'object:import');
    expect(importCall?.[0]).toEqual(['object:import', '--scriptid', 'customrecord_x', '--type', 'ALL', '--destinationfolder', '/Objects']);
    // import ran against source
    expect(mockSetDefaultAuthId).toHaveBeenCalledWith('/proj', 'CG-intQA');
    // second runBuild received the imported object path
    expect(mockRunBuild).toHaveBeenLastCalledWith(expect.objectContaining({ extraObjectPaths: ['src/Objects/customrecord_x.xml'] }));
    expect(mockSetDefaultAuthId).toHaveBeenLastCalledWith('/proj', 'CG-intQA'); // restored
  });
});

describe('max rounds cap', () => {
  it('fails after --max-import-rounds when object stays missing', async () => {
    mockRunSuitecloud.mockImplementation((args: string[]) => (args[0] === 'object:import' ? { status: 0, output: '' } : { status: 1, output: 'missing' }));
    mockParseMissing.mockReturnValue(['customrecord_x']);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA', '--auto-import', '--max-import-rounds', '2']))
      .rejects.toThrow('exit');
    const deployCalls = mockRunSuitecloud.mock.calls.filter((c) => (c[0] as string[])[0] === 'project:deploy');
    expect(deployCalls.length).toBe(2); // capped at 2 rounds
    exitSpy.mockRestore();
  });
});

describe('dry-run', () => {
  it('validates (not deploys) and reports would-import without importing', async () => {
    mockRunSuitecloud.mockReturnValue({ status: 1, output: 'missing' });
    mockParseMissing.mockReturnValue(['customrecord_x']);
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--target', 'CG-UAT', '--source', 'CG-intQA', '--dry-run']);
    expect(mockRunSuitecloud).toHaveBeenCalledWith(['project:validate', '--server'], expect.objectContaining({ cwd: '/proj' }));
    const importCalls = mockRunSuitecloud.mock.calls.filter((c) => (c[0] as string[])[0] === 'object:import');
    expect(importCalls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — confirm fail**
```bash
cd /Users/rpinto/Documents/CGEAA/ndf && npm test -- deploy
```

- [ ] **Step 3: Implement `deploy.ts`**

```typescript
import { Command } from 'commander';
import { createInterface } from 'readline';
import { getProjectDir, getProductionAuthId, getRunTests } from '../helpers/project-dir.js';
import { getActiveAuthId, ProductionGuardError } from '../helpers/production-guard.js';
import { getCurrentBranch } from '../helpers/git.js';
import { validateAuthId, setDefaultAuthId } from '../helpers/auth.js';
import { runSuitecloud } from '../helpers/suitecloud.js';
import { parseMissingObjectRefs } from '../helpers/dependency-parser.js';
import { runBuild } from '../helpers/build-runner.js';
import { output } from '../helpers/output.js';

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Build and deploy feature changes to a target NetSuite environment, auto-resolving object dependencies')
    .requiredOption('--target <authId>', 'target environment auth ID to deploy to')
    .option('--source <authId>', 'source environment auth ID to import absent objects from')
    .option('--auto-import', 'permit importing absent objects without confirmation (for CI)')
    .option('--dry-run', 'validate against the target and preview; never deploys or imports')
    .option('--skip-tests', 'skip SuiteCloud Jest tests for this deploy')
    .option('--max-import-rounds <n>', 'max import+retry iterations', '10')
    .action(async (opts: {
      target: string; source?: string; autoImport?: boolean; dryRun?: boolean;
      skipTests?: boolean; maxImportRounds: string;
    }) => {
      const projectDir = getProjectDir();
      let failed = false;
      let restoreAuthId: string | undefined;
      try {
        validateAuthId(projectDir, opts.target);
        if (opts.source) validateAuthId(projectDir, opts.source);

        // Production guard on the TARGET (before any swap/network).
        if (opts.target === getProductionAuthId() && getCurrentBranch(projectDir) !== 'main') {
          throw new ProductionGuardError(getCurrentBranch(projectDir));
        }

        const maxRounds = Math.max(1, parseInt(opts.maxImportRounds, 10) || 10);
        const skipTests = opts.skipTests || getRunTests() === false;
        const env = skipTests
          ? { ...process.env, NDF_SKIP_TESTS: 'true' }
          : { ...process.env, NDF_SKIP_TESTS: undefined };
        if (skipTests) output.info('Skipping SuiteCloud Jest tests for this deploy (NDF_SKIP_TESTS=true).');

        restoreAuthId = getActiveAuthId(projectDir);
        const importedObjectPaths: string[] = [];
        let source = opts.source;

        for (let round = 1; ; round++) {
          await runBuild({ projectDir, dryRun: false, extraObjectPaths: importedObjectPaths });

          setDefaultAuthId(projectDir, opts.target);
          const cmd = opts.dryRun ? ['project:validate', '--server'] : ['project:deploy'];
          const res = runSuitecloud(cmd, { cwd: projectDir, env });
          process.stdout.write(res.output);
          if (res.status === 0) { output.success(opts.dryRun ? 'Validation passed.' : 'Deploy complete.'); break; }

          const missing = parseMissingObjectRefs(res.output);
          if (missing.length === 0) {
            throw new Error('Deploy failed with no resolvable missing-object dependency (see output above).');
          }
          if (round >= maxRounds) {
            throw new Error(
              `Reached max import rounds (${maxRounds}). Imported: ${importedObjectPaths.map(objId).join(', ') || '(none)'}; still missing: ${missing.join(', ')}.`,
            );
          }
          if (opts.dryRun) {
            output.info(`Would import from source: ${missing.join(', ')} (dry run — not importing).`);
            break;
          }

          // Need a source account to import from.
          if (!source) {
            if (process.stdin.isTTY) {
              source = (await ask(`Objects to import: ${missing.join(', ')}. Source auth ID: `)).trim();
              validateAuthId(projectDir, source);
            } else {
              throw new Error(`Missing objects require import: ${missing.join(', ')}. Re-run with --source <authId>.`);
            }
          }

          // Gate the import.
          let permitted: boolean;
          if (process.stdin.isTTY) {
            const a = (await ask(`Import ${missing.join(', ')} from ${source}? [y/N] `)).trim().toLowerCase();
            permitted = a === 'y' || a === 'yes';
          } else {
            permitted = !!opts.autoImport;
          }
          if (!permitted) {
            throw new Error(
              `Import of ${missing.join(', ')} not permitted` +
              (process.stdin.isTTY ? ' (declined).' : ' — pass --auto-import to allow in non-interactive mode.'),
            );
          }

          // Import named objects from source, then loop (runBuild will include them).
          setDefaultAuthId(projectDir, source);
          const imp = runSuitecloud(
            ['object:import', '--scriptid', ...missing, '--type', 'ALL', '--destinationfolder', '/Objects'],
            { cwd: projectDir },
          );
          process.stdout.write(imp.output);
          if (imp.status !== 0) throw new Error(`object:import failed:\n${imp.output}`);
          for (const id of missing) importedObjectPaths.push(`src/Objects/${id}.xml`);
          if (importedObjectPaths.length) {
            output.info(`Imported from ${source}: ${missing.join(', ')}`);
          }
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        failed = true;
      } finally {
        if (restoreAuthId !== undefined) setDefaultAuthId(projectDir, restoreAuthId);
      }
      if (failed) process.exit(1);
    });
}

function objId(path: string): string { return path.replace(/^src\/Objects\//, '').replace(/\.xml$/, ''); }
```

- [ ] **Step 4: Run — confirm pass; full suite; build**
```bash
npm test && npm run build
```

- [ ] **Step 5: Smoke-test help wiring**
```bash
cd /Users/rpinto/Documents/CGEAA && ./cgeaa netsuite deploy --help
```
Expected: shows `--target`, `--source`, `--auto-import`, `--dry-run`, `--skip-tests`, `--max-import-rounds`.

- [ ] **Step 6: Commit**
```bash
git add ndf/src/commands/deploy.ts ndf/src/__tests__/commands/deploy.test.ts
git commit -m "feat(ndf): deploy resolves object dependencies (adddependencies + gated named import loop)"
```

---

## Task 7: Docs — README-NDF, CLAUDE.md, TODO.md, GitHub Actions snippet

**Files:**
- Modify: `ndf/README-NDF.md`, `ndf/CLAUDE.md`, `ndf/TODO.md`

No tests (docs only). Keep statements consistent with the shipped behavior from Tasks 1–6.

- [ ] **Step 1: README-NDF.md** — rewrite the `deploy` section to the new surface
  `deploy --target <authId> [--source <authId>] [--auto-import] [--dry-run] [--skip-tests] [--max-import-rounds <n>]`.
  Document: the resolve loop (declare via adddependencies → import named-absent objects from `--source` → retry, capped at 10 rounds); the gating (confirm locally / `--auto-import` in CI); that `--target`/`--source` must be configured auth IDs; that imported object XML is left in the working tree for review (NDF never auto-commits); and that the production guard applies to `--target`. Add a **GitHub Actions** example:
  ```yaml
  - name: Deploy feature to UAT (auto-resolve deps)
    run: ./cgeaa netsuite deploy --target CG-UAT --source CG-intQA --auto-import
  ```
  Note the deploy writes `deploy.xml`/`manifest.xml`; commit them on the feature branch so CI deploys the intended scope.

- [ ] **Step 2: CLAUDE.md** — update the `deploy` row and add a short "dependency resolution" subsection: the `defaultAuthId`-swap account model (set source for `object:import`, target for `adddependencies`/`validate`/`deploy`, restore in `finally`); build now runs `project:adddependencies`; named-only import from parsed SDF errors; `MAX_ROUNDS` default 10. Note the two production guards remain distinct (switch guards target arg; deploy guards `--target`).

- [ ] **Step 3: TODO.md** — move "Auto-import missing objects + retry deploy" out of Future features into a "Shipped" note (date 2026-10-01), summarizing the hybrid design and that it's gated/capped. Keep remaining deferred minors (#2 projectname/frameworkversion hardcoded, #3 sdfPath passthrough, #4 blank-line strip, #5 unused import). Note that deferred-minor #1 (feature-scoped manifest objects) is **retired** — `adddependencies` now owns manifest dependencies.

- [ ] **Step 4: Commit**
```bash
cd /Users/rpinto/Documents/CGEAA
git add ndf/README-NDF.md ndf/CLAUDE.md ndf/TODO.md
git commit -m "docs(ndf): document deploy dependency auto-resolution (--target/--source/--auto-import)"
```

---

## Live verification (NDF dev flow — runs during execution, not a code task)

Per the required NDF dev flow, the build-runner (Task 4/5) and deploy (Task 6) tasks get a live intQA stage after their standard + adversarial reviews, on the FinSys `cicd/ndf` branch (ask the user to confirm the branch first). Reproduce a genuinely-absent-object dependency, confirm:
- declare-only resolution via `adddependencies` where the object exists in target;
- named-only import from `--source` for a truly-absent object, then green redeploy;
- caps and gating (CI needs `--auto-import`);
- `defaultAuthId` restored and intQA state reverted afterward (redeploy originals; delete imported test objects).

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Command surface (`build`, `deploy` flags) | 6 (deploy), 4/5 (build) |
| `build` runs `project:adddependencies` (retires manifest hand-roll) | 4 |
| Account model via `defaultAuthId` swap + restore-on-failure | 3 (helpers), 6 (orchestration + finally) |
| Resolution loop (adddependencies → parse → import → rebuild → retry) | 6 |
| Error parsing, degrade-safe on unparseable | 2 (parser), 6 (empty ⇒ surface raw) |
| Guardrails: named-only, cap (MAX_ROUNDS=10), confirm local / `--auto-import` CI, source required | 6 |
| Imported object paths unioned into deploy scope | 5 |
| CI usage + GitHub Actions snippet | 7 |
| Production guard on `--target` | 6 |
| Testing (unit + live intQA via dev flow) | 2–6 unit; live-verification section |
| SDF behaviors verified first | 1 (spike) |

**Placeholder scan:** No TBD/TODO/"handle errors"/vague steps. All code blocks are concrete; the only intentional deferral is Task 1's spike adjusting Task 2's regex to verbatim SDF text, which is explicit.

**Type consistency:** `SuitecloudResult {status, output}`, `runSuitecloud(args,{cwd,env})`, `BuildOptions {projectDir,dryRun,extraObjectPaths?}`, `parseMissingObjectRefs(string): string[]`, `validateAuthId(projectDir,authId)`, `setDefaultAuthId(projectDir,authId)`, `getActiveAuthId(projectDir)`, `getCurrentBranch(projectDir)` — names/signatures consistent across Tasks 2–6.

**Review Focus coverage:** typo target → Task 6 "unknown target" test; restore-on-throw → Task 6 "unparseable failure"/happy-path assert `setDefaultAuthId` last call is restore; unparseable error → Task 2 + Task 6 test; infinite loop → Task 6 "max rounds cap" test; CI no `--auto-import` → Task 6 "CI needs import without --auto-import" test. All five pinned to tests.
