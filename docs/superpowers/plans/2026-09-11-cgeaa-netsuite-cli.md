# cgeaa netsuite CLI (NDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `cgeaa netsuite` — a TypeScript CLI (NDF) that wraps the SuiteCloud SDK for feature-branch NetSuite development: environment management, production guard, and git-diff-based deploy.xml/manifest.xml generation.

**Architecture:** New `ndf/` directory in CGEAA mirrors the `zdf/` structure exactly (TypeScript, tsup, Commander.js, Vitest). Dispatched via `cgeaa-lib/netsuite.sh` → `ndf/dist/ndf.js`. Reads `netsuite_project_dir` and `netsuite_production_auth_id` from `~/.cgeaa/config`. Runs `suitecloud` subprocess calls with `--projectdir` so commands work from any directory.

**Tech Stack:** TypeScript 5.x, Commander.js 12, chalk 4, Vitest 1.x, tsup 8.x, Node ≥18 stdlib only (no XML parser dependency).

**Spec:** `docs/superpowers/specs/2026-09-11-cgeaa-netsuite-cli-design.md`

## Global Constraints

- All TypeScript internal imports use `.js` extension (Node16 module resolution), e.g. `import { foo } from '../helpers/git.js'`
- `"type": "commonjs"` in `ndf/package.json`
- Vitest mocks use `vi.hoisted(() => vi.fn())` — never declare mocks outside `vi.hoisted`
- Commits stage only explicit file paths — never `git add -A`
- `cd ndf && npm run build && npm test` must pass before every commit
- No new runtime dependencies beyond what is listed in Task 1's `package.json`
- The SDF project root is at the path stored in `netsuite_project_dir` (`~/.cgeaa/config`). All `suitecloud` calls pass `--projectdir <projectDir>`
- Production auth ID is stored as `netsuite_production_auth_id` in `~/.cgeaa/config`; never hardcoded
- `~/.cgeaa/config` format: one `key=value` per line, no spaces around `=`, `#` lines are comments

---

## File Map

```
ndf/
├── bin/ndf.ts                              # thin entry shim
├── src/
│   ├── program.ts                          # buildProgram() — registers all commands
│   ├── commands/
│   │   ├── setup.ts                        # cgeaa netsuite setup
│   │   ├── envs.ts                         # cgeaa netsuite envs
│   │   ├── switch-env.ts                   # cgeaa netsuite switch <authId>
│   │   ├── build.ts                        # cgeaa netsuite build [--dry-run]
│   │   ├── deploy.ts                       # cgeaa netsuite deploy [--dry-run]
│   │   └── pull.ts                         # cgeaa netsuite pull object|file
│   └── helpers/
│       ├── output.ts                       # success/error/info/warn (mirrors zdf)
│       ├── config.ts                       # read/write ~/.cgeaa/config
│       ├── project-dir.ts                  # resolve + validate netsuite_project_dir
│       ├── git.ts                          # getMergeBase, getChangedFiles, getCurrentBranch
│       ├── xml.ts                          # generateDeployXml, generateManifestXml
│       └── production-guard.ts             # checkProductionGuard
├── src/__tests__/
│   ├── helpers/
│   │   ├── config.test.ts
│   │   ├── project-dir.test.ts
│   │   ├── git.test.ts
│   │   ├── xml.test.ts
│   │   └── production-guard.test.ts
│   └── commands/
│       ├── build.test.ts
│       ├── deploy.test.ts
│       ├── envs.test.ts
│       ├── switch-env.test.ts
│       └── pull.test.ts
├── package.json
└── tsconfig.json

cgeaa-lib/netsuite.sh                       # new dispatch module (mirrors zuora.sh)
cgeaa                                       # modify: source netsuite.sh, add netsuite dispatch
```

---

### Task 1: NDF package scaffolding + cgeaa wiring

**Files:**
- Create: `ndf/package.json`
- Create: `ndf/tsconfig.json`
- Create: `ndf/bin/ndf.ts`
- Create: `ndf/src/program.ts`
- Create: `ndf/src/helpers/output.ts`
- Create: `ndf/src/__tests__/helpers/output.test.ts`
- Create: `cgeaa-lib/netsuite.sh`
- Modify: `cgeaa` (3 locations — see steps)

**Interfaces:**
- Produces: `buildProgram(): Command` (from `src/program.ts`) — consumed by every later task's tests via a `makeProgram()` helper
- Produces: `execute_netsuite()` bash function (from `netsuite.sh`) — consumed by `cgeaa`

- [ ] **Step 1: Create `ndf/package.json`**

```json
{
  "name": "ndf",
  "version": "1.0.0",
  "description": "NetSuite Development Framework CLI",
  "type": "commonjs",
  "bin": { "ndf": "./dist/ndf.js" },
  "main": "./dist/ndf.js",
  "scripts": {
    "build": "tsup bin/ndf.ts --format cjs --out-dir dist",
    "dev": "tsx bin/ndf.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=18.0.0" },
  "files": ["dist"],
  "dependencies": {
    "chalk": "^4.1.2",
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `ndf/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["bin/**/*", "src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `ndf/src/helpers/output.ts`**

```typescript
import chalk from 'chalk';

export const output = {
  success: (msg: string) => console.log(chalk.green(`✔ ${msg}`)),
  error: (msg: string) => console.error(chalk.red(`✖ ${msg}`)),
  info: (msg: string) => console.log(chalk.cyan(`ℹ ${msg}`)),
  warn: (msg: string) => console.warn(chalk.yellow(`⚠ ${msg}`)),
};
```

- [ ] **Step 4: Write failing test for output**

`ndf/src/__tests__/helpers/output.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

import { output } from '../../helpers/output.js';

describe('output', () => {
  beforeEach(() => { mockLog.mockClear(); mockError.mockClear(); mockWarn.mockClear(); });

  it('success logs green checkmark', () => {
    output.success('done');
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('done'));
  });

  it('error logs red cross to stderr', () => {
    output.error('bad');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('bad'));
  });
});
```

- [ ] **Step 5: Create `ndf/src/program.ts`**

```typescript
import { Command } from 'commander';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ndf')
    .description('NetSuite Development Framework — cgeaa netsuite commands')
    .version('1.0.0');
  return program;
}
```

- [ ] **Step 6: Create `ndf/bin/ndf.ts`**

```typescript
import { buildProgram } from '../src/program.js';

buildProgram().parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 7: Install dependencies and verify build**

```bash
cd ndf && npm install && npm run build
```

Expected: `dist/ndf.js` created, no errors.

```bash
node dist/ndf.js --help
```

Expected: prints NDF help text.

- [ ] **Step 8: Run tests**

```bash
npm test
```

Expected: output.test.ts passes.

- [ ] **Step 9: Create `cgeaa-lib/netsuite.sh`**

Mirror `cgeaa-lib/zuora.sh` exactly, substituting `zuora`→`netsuite`, `zdf`→`ndf`, `ZDF`→`NDF`:

```bash
#!/bin/bash

# netsuite.sh - NetSuite Development Framework (NDF) dispatch module
#
# Delegates all arguments after 'netsuite' to the ndf CLI.

NDF_SOURCE_DIR="${SCRIPT_DIR}/ndf"

_find_ndf() {
    local bundled_bin="${NDF_SOURCE_DIR}/dist/ndf.js"
    if [ -f "$bundled_bin" ]; then
        echo "node ${bundled_bin}"
        return
    fi
    echo ""
}

_build_ndf() {
    if [ ! -d "$NDF_SOURCE_DIR" ]; then
        log_error "NDF source not found at ${NDF_SOURCE_DIR}"
        log_error "Re-run cgeaa-setup from the CGEAA repository checkout to install NDF."
        exit 1
    fi
    if [ ! -w "$NDF_SOURCE_DIR" ]; then
        log_error "NDF is not built and its source at ${NDF_SOURCE_DIR} is not writable."
        log_error "Re-run cgeaa-setup from the CGEAA repository checkout to (re)install NDF."
        exit 1
    fi
    if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
        log_error "node and npm are required to build NDF (Node.js >=18)."
        exit 1
    fi
    log_info "Building NDF from source at ${NDF_SOURCE_DIR}..."
    (cd "$NDF_SOURCE_DIR" && npm install --silent && npm run build --silent) || {
        log_error "NDF build failed. Check the output above."
        exit 1
    }
    log_success "NDF built successfully."
}

execute_netsuite() {
    local ndf_cmd
    ndf_cmd="$(_find_ndf)"

    if [ -z "$ndf_cmd" ]; then
        log_warn "ndf not found. Attempting to build from bundled source..."
        _build_ndf
        ndf_cmd="node ${NDF_SOURCE_DIR}/dist/ndf.js"
    fi

    # shellcheck disable=SC2086
    $ndf_cmd "${NETSUITE_ARGS[@]}"
}
```

- [ ] **Step 10: Wire `netsuite` into `cgeaa` — three edits**

**Edit 1** — source the new module (after the `zuora.sh` source line, around line 27):
Find: `source "${CGEAA_LIB_DIR}/zuora.sh"`
Add after: `source "${CGEAA_LIB_DIR}/netsuite.sh"`

**Edit 2** — add `NETSUITE_ARGS` capture in `parse_args` (after the `zuora` short-circuit block, around line 197):
Find:
```bash
    if [ "$COMMAND" = "zuora" ]; then
        ZUORA_ARGS=("$@")
        return
    fi
```
Add after:
```bash
    if [ "$COMMAND" = "netsuite" ]; then
        NETSUITE_ARGS=("$@")
        return
    fi
```

**Edit 3** — add `netsuite` to the valid-command case and dispatch in `main()`:
Find: `validate|deploy|test|manifest|logs|diff|open|rollback|update|zuora)`
Replace: `validate|deploy|test|manifest|logs|diff|open|rollback|update|zuora|netsuite)`

Find (in `main()`):
```bash
    if [ "$COMMAND" = "zuora" ]; then
        execute_zuora
        exit $?
    fi
```
Add after:
```bash
    if [ "$COMMAND" = "netsuite" ]; then
        execute_netsuite
        exit $?
    fi
```

- [ ] **Step 11: Smoke-test end-to-end wiring**

```bash
cd /path/to/CGEAA && ./cgeaa netsuite --help
```

Expected: NDF help text printed.

- [ ] **Step 12: Commit**

```bash
git add ndf/ cgeaa-lib/netsuite.sh cgeaa
git commit -m "feat(ndf): scaffold NDF TypeScript CLI and wire into cgeaa"
```

---

### Task 2: Config reader + project-dir helper

**Files:**
- Create: `ndf/src/helpers/config.ts`
- Create: `ndf/src/helpers/project-dir.ts`
- Create: `ndf/src/__tests__/helpers/config.test.ts`
- Create: `ndf/src/__tests__/helpers/project-dir.test.ts`

**Interfaces:**
- Produces: `readCgeaaConfig(): Record<string, string>` — reads `~/.cgeaa/config`
- Produces: `writeCgeaaConfigKey(key: string, value: string): void` — upserts a key
- Produces: `getProjectDir(): string` — throws `NdfConfigError` if missing/invalid
- Produces: `getProductionAuthId(): string` — throws `NdfConfigError` if missing
- Produces: `class NdfConfigError extends Error` — sentinel for setup-needed errors

- [ ] **Step 1: Write failing tests for config.ts**

`ndf/src/__tests__/helpers/config.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

import { readCgeaaConfig, writeCgeaaConfigKey } from '../../helpers/config.js';

const CONFIG_PATH = join(homedir(), '.cgeaa', 'config');

describe('readCgeaaConfig', () => {
  it('returns empty object when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readCgeaaConfig()).toEqual({});
  });

  it('parses key=value lines', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('netsuite_project_dir=/foo/bar\nnetsuite_production_auth_id=CG-Prod\n');
    expect(readCgeaaConfig()).toEqual({
      netsuite_project_dir: '/foo/bar',
      netsuite_production_auth_id: 'CG-Prod',
    });
  });

  it('ignores comment lines and blank lines', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# comment\n\nfoo=bar\n');
    expect(readCgeaaConfig()).toEqual({ foo: 'bar' });
  });
});

describe('writeCgeaaConfigKey', () => {
  it('creates config dir and writes key=value when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    writeCgeaaConfigKey('mykey', 'myval');
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(CONFIG_PATH, 'mykey=myval\n', 'utf-8');
  });

  it('updates existing key in place', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('other=x\nmykey=old\n');
    writeCgeaaConfigKey('mykey', 'new');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.stringContaining('mykey=new'),
      'utf-8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.stringContaining('other=x'),
      'utf-8',
    );
  });

  it('appends new key when not present', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('other=x\n');
    writeCgeaaConfigKey('newkey', 'val');
    const written = (mockWriteFileSync.mock.calls[0] as unknown[])[1] as string;
    expect(written).toContain('newkey=val');
    expect(written).toContain('other=x');
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd ndf && npm test -- config
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ndf/src/helpers/config.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.cgeaa', 'config');

export function readCgeaaConfig(): Record<string, string> {
  if (!existsSync(CONFIG_PATH)) return {};
  const lines = readFileSync(CONFIG_PATH, 'utf-8').split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      result[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  }
  return result;
}

export function writeCgeaaConfigKey(key: string, value: string): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  let content = '';
  if (existsSync(CONFIG_PATH)) {
    content = readFileSync(CONFIG_PATH, 'utf-8');
  }
  const lines = content.split('\n').filter(Boolean);
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(CONFIG_PATH, lines.join('\n') + '\n', 'utf-8');
}
```

- [ ] **Step 4: Write failing tests for project-dir.ts**

`ndf/src/__tests__/helpers/project-dir.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

const mockReadCgeaaConfig = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/config.js', () => ({ readCgeaaConfig: mockReadCgeaaConfig }));
vi.mock('fs', () => ({ existsSync: mockExistsSync }));

import { getProjectDir, getProductionAuthId, NdfConfigError } from '../../helpers/project-dir.js';

describe('getProjectDir', () => {
  it('returns project dir when config key present and suitecloud.config.js exists', () => {
    mockReadCgeaaConfig.mockReturnValue({ netsuite_project_dir: '/foo/NetSuite' });
    mockExistsSync.mockReturnValue(true);
    expect(getProjectDir()).toBe('/foo/NetSuite');
  });

  it('throws NdfConfigError when key is missing', () => {
    mockReadCgeaaConfig.mockReturnValue({});
    expect(() => getProjectDir()).toThrow(NdfConfigError);
    expect(() => getProjectDir()).toThrow("Run 'cgeaa netsuite setup'");
  });

  it('throws NdfConfigError when suitecloud.config.js not found at path', () => {
    mockReadCgeaaConfig.mockReturnValue({ netsuite_project_dir: '/bad/path' });
    mockExistsSync.mockReturnValue(false);
    expect(() => getProjectDir()).toThrow(NdfConfigError);
  });
});

describe('getProductionAuthId', () => {
  it('returns production auth ID from config', () => {
    mockReadCgeaaConfig.mockReturnValue({ netsuite_production_auth_id: 'CG-Prod' });
    expect(getProductionAuthId()).toBe('CG-Prod');
  });

  it('throws NdfConfigError when missing', () => {
    mockReadCgeaaConfig.mockReturnValue({});
    expect(() => getProductionAuthId()).toThrow(NdfConfigError);
  });
});
```

- [ ] **Step 5: Implement `ndf/src/helpers/project-dir.ts`**

```typescript
import { existsSync } from 'fs';
import { join } from 'path';
import { readCgeaaConfig } from './config.js';

export class NdfConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NdfConfigError';
  }
}

export function getProjectDir(): string {
  const config = readCgeaaConfig();
  const dir = config['netsuite_project_dir'];
  if (!dir) {
    throw new NdfConfigError(
      "netsuite_project_dir not configured. Run 'cgeaa netsuite setup' to configure NetSuite.",
    );
  }
  if (!existsSync(join(dir, 'suitecloud.config.js'))) {
    throw new NdfConfigError(
      `netsuite_project_dir '${dir}' does not contain suitecloud.config.js. Run 'cgeaa netsuite setup' to reconfigure.`,
    );
  }
  return dir;
}

export function getProductionAuthId(): string {
  const config = readCgeaaConfig();
  const authId = config['netsuite_production_auth_id'];
  if (!authId) {
    throw new NdfConfigError(
      "netsuite_production_auth_id not configured. Run 'cgeaa netsuite setup' to configure NetSuite.",
    );
  }
  return authId;
}
```

- [ ] **Step 6: Run tests, build, commit**

```bash
npm test -- config project-dir && npm run build
git add ndf/src/helpers/config.ts ndf/src/helpers/project-dir.ts \
        ndf/src/__tests__/helpers/config.test.ts ndf/src/__tests__/helpers/project-dir.test.ts
git commit -m "feat(ndf): add config reader and project-dir helpers"
```

---

### Task 3: Git helper

**Files:**
- Create: `ndf/src/helpers/git.ts`
- Create: `ndf/src/__tests__/helpers/git.test.ts`

**Interfaces:**
- Produces: `getMergeBase(projectDir: string): string` — returns SHA of `git merge-base main HEAD`
- Produces: `interface ChangedFiles { scripts: string[]; objects: string[] }`
- Produces: `getChangedFiles(projectDir: string, mergeBase: string): ChangedFiles`
- Produces: `getCurrentBranch(projectDir: string): string`
- `scripts` entries: relative paths like `src/FileCabinet/SuiteScripts/foo.js`
- `objects` entries: relative paths like `src/Objects/customscript_foo.xml`

- [ ] **Step 1: Write failing tests**

`ndf/src/__tests__/helpers/git.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));

import { getMergeBase, getChangedFiles, getCurrentBranch } from '../../helpers/git.js';

describe('getMergeBase', () => {
  it('returns trimmed SHA from git merge-base', () => {
    mockExecSync.mockReturnValue(Buffer.from('abc123\n'));
    const result = getMergeBase('/proj');
    expect(mockExecSync).toHaveBeenCalledWith('git merge-base main HEAD', {
      cwd: '/proj',
    });
    expect(result).toBe('abc123');
  });
});

describe('getChangedFiles', () => {
  it('categorises SuiteScripts as scripts and Objects as objects', () => {
    mockExecSync.mockReturnValue(
      Buffer.from(
        'src/FileCabinet/SuiteScripts/foo.js\nsrc/Objects/customscript_bar.xml\nREADME.md\n',
      ),
    );
    const result = getChangedFiles('/proj', 'abc123');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff abc123..HEAD --name-only',
      { cwd: '/proj' },
    );
    expect(result.scripts).toEqual(['src/FileCabinet/SuiteScripts/foo.js']);
    expect(result.objects).toEqual(['src/Objects/customscript_bar.xml']);
  });

  it('returns empty arrays when no relevant files changed', () => {
    mockExecSync.mockReturnValue(Buffer.from('README.md\npackage.json\n'));
    const result = getChangedFiles('/proj', 'abc123');
    expect(result.scripts).toEqual([]);
    expect(result.objects).toEqual([]);
  });

  it('excludes deleted files that no longer exist (node_modules, .attributes)', () => {
    mockExecSync.mockReturnValue(
      Buffer.from(
        'src/FileCabinet/SuiteScripts/.attributes\nsrc/FileCabinet/SuiteScripts/real.js\n',
      ),
    );
    const result = getChangedFiles('/proj', 'abc123');
    expect(result.scripts).toEqual(['src/FileCabinet/SuiteScripts/real.js']);
  });
});

describe('getCurrentBranch', () => {
  it('returns current branch name', () => {
    mockExecSync.mockReturnValue(Buffer.from('feature/my-branch\n'));
    expect(getCurrentBranch('/proj')).toBe('feature/my-branch');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --abbrev-ref HEAD',
      { cwd: '/proj' },
    );
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm test -- git
```

- [ ] **Step 3: Implement `ndf/src/helpers/git.ts`**

```typescript
import { execSync } from 'child_process';
import { basename } from 'path';

export interface ChangedFiles {
  scripts: string[];
  objects: string[];
}

const EXCLUDED_FILENAMES = new Set(['.attributes', '.eslintrc.json']);

export function getMergeBase(projectDir: string): string {
  return execSync('git merge-base main HEAD', { cwd: projectDir }).toString().trim();
}

export function getChangedFiles(projectDir: string, mergeBase: string): ChangedFiles {
  const raw = execSync(`git diff ${mergeBase}..HEAD --name-only`, { cwd: projectDir })
    .toString()
    .trim();
  const files = raw ? raw.split('\n').map((f) => f.trim()).filter(Boolean) : [];

  const scripts = files.filter(
    (f) =>
      f.startsWith('src/FileCabinet/SuiteScripts/') &&
      !f.includes('/node_modules/') &&
      !EXCLUDED_FILENAMES.has(basename(f)),
  );

  const objects = files.filter((f) => f.startsWith('src/Objects/') && f.endsWith('.xml'));

  return { scripts, objects };
}

export function getCurrentBranch(projectDir: string): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir }).toString().trim();
}
```

- [ ] **Step 4: Run tests, build, commit**

```bash
npm test -- git && npm run build
git add ndf/src/helpers/git.ts ndf/src/__tests__/helpers/git.test.ts
git commit -m "feat(ndf): add git helper (getMergeBase, getChangedFiles, getCurrentBranch)"
```

---

### Task 4: XML helper

**Files:**
- Create: `ndf/src/helpers/xml.ts`
- Create: `ndf/src/__tests__/helpers/xml.test.ts`

**Interfaces:**
- Produces: `generateDeployXml(scripts: string[], objects: string[]): string`
  - `scripts`: paths from `ChangedFiles.scripts` (e.g. `src/FileCabinet/SuiteScripts/foo.js`)
  - `objects`: paths from `ChangedFiles.objects` (e.g. `src/Objects/customscript_foo.xml`)
  - Output: well-formed `deploy.xml` string with SDF `~/` paths
- Produces: `generateManifestXml(existingManifestPath: string, changedObjectIds: string[]): string`
  - `changedObjectIds`: filenames without `.xml`, e.g. `['customscript_foo', 'customrole_bar']`
  - Output: well-formed `manifest.xml` string with preserved `<features>` and `<files>` blocks
- Produces: `objectIdFromPath(objectPath: string): string` — `src/Objects/customscript_foo.xml` → `customscript_foo`

- [ ] **Step 1: Write failing tests**

`ndf/src/__tests__/helpers/xml.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));

import { generateDeployXml, generateManifestXml, objectIdFromPath } from '../../helpers/xml.js';

describe('objectIdFromPath', () => {
  it('strips src/Objects/ prefix and .xml suffix', () => {
    expect(objectIdFromPath('src/Objects/customscript_foo.xml')).toBe('customscript_foo');
  });
});

describe('generateDeployXml', () => {
  it('generates targeted deploy.xml with scripts and objects', () => {
    const xml = generateDeployXml(
      ['src/FileCabinet/SuiteScripts/foo.js', 'src/FileCabinet/SuiteScripts/bar.js'],
      ['src/Objects/customscript_foo.xml'],
    );
    expect(xml).toContain('<deploy>');
    expect(xml).toContain('~/FileCabinet/SuiteScripts/foo.js');
    expect(xml).toContain('~/FileCabinet/SuiteScripts/bar.js');
    expect(xml).toContain('~/Objects/customscript_foo.xml');
    expect(xml).toContain('~/AccountConfiguration/*');
    expect(xml).toContain('</deploy>');
  });

  it('omits <files> when no scripts', () => {
    const xml = generateDeployXml([], ['src/Objects/customscript_foo.xml']);
    expect(xml).not.toContain('<files>');
    expect(xml).toContain('<objects>');
  });

  it('omits <objects> when no objects', () => {
    const xml = generateDeployXml(['src/FileCabinet/SuiteScripts/foo.js'], []);
    expect(xml).toContain('<files>');
    expect(xml).not.toContain('<objects>');
  });

  it('always includes <configuration>', () => {
    const xml = generateDeployXml([], []);
    expect(xml).toContain('<configuration>');
    expect(xml).toContain('~/AccountConfiguration/*');
  });

  it('converts src/ prefix to ~/ SDF prefix', () => {
    const xml = generateDeployXml(['src/FileCabinet/SuiteScripts/myscript.js'], []);
    expect(xml).toContain('~/FileCabinet/SuiteScripts/myscript.js');
    expect(xml).not.toContain('src/FileCabinet');
  });
});

describe('generateManifestXml', () => {
  const EXISTING_MANIFEST = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>NetSuite</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
      <feature required="true">SERVERSIDESCRIPTING</feature>
    </features>
    <objects>
      <object>old_object</object>
    </objects>
    <files>
      <file>/SuiteBundles/Bundle 123/somefile.js</file>
    </files>
  </dependencies>
</manifest>`;

  it('replaces <objects> with changed object IDs', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', ['customscript_new']);
    expect(xml).toContain('<object>customscript_new</object>');
    expect(xml).not.toContain('<object>old_object</object>');
  });

  it('preserves <features> verbatim', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', ['customscript_new']);
    expect(xml).toContain('<feature required="true">SERVERSIDESCRIPTING</feature>');
  });

  it('preserves <files> verbatim', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', ['customscript_new']);
    expect(xml).toContain('<file>/SuiteBundles/Bundle 123/somefile.js</file>');
  });

  it('generates empty <objects> when no changed objects', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', []);
    expect(xml).toContain('<objects>');
    expect(xml).toContain('</objects>');
    expect(xml).not.toContain('<object>');
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm test -- xml
```

- [ ] **Step 3: Implement `ndf/src/helpers/xml.ts`**

```typescript
import { readFileSync } from 'fs';

export function objectIdFromPath(objectPath: string): string {
  // src/Objects/customscript_foo.xml → customscript_foo
  return objectPath.replace(/^src\/Objects\//, '').replace(/\.xml$/, '');
}

function sdfPath(srcRelativePath: string): string {
  // src/FileCabinet/SuiteScripts/foo.js → ~/FileCabinet/SuiteScripts/foo.js
  return srcRelativePath.replace(/^src\//, '~/');
}

export function generateDeployXml(scripts: string[], objects: string[]): string {
  const lines: string[] = ['<deploy>'];

  lines.push('    <configuration>');
  lines.push('        <path>~/AccountConfiguration/*</path>');
  lines.push('    </configuration>');

  if (scripts.length > 0) {
    lines.push('    <files>');
    for (const s of scripts) {
      lines.push(`        <path>${sdfPath(s)}</path>`);
    }
    lines.push('    </files>');
  }

  if (objects.length > 0) {
    lines.push('    <objects>');
    for (const o of objects) {
      lines.push(`        <path>${sdfPath(o)}</path>`);
    }
    lines.push('    </objects>');
  }

  lines.push('</deploy>');
  return lines.join('\n');
}

function extractBlock(xml: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  const end = xml.indexOf(close);
  if (start === -1 || end === -1) return `${open}${close}`;
  return xml.slice(start, end + close.length);
}

export function generateManifestXml(existingManifestPath: string, changedObjectIds: string[]): string {
  const existing = readFileSync(existingManifestPath, 'utf-8');

  const featuresBlock = extractBlock(existing, 'features');
  const filesBlock = extractBlock(existing, 'files');

  const objectLines = changedObjectIds.map((id) => `      <object>${id}</object>`).join('\n');
  const objectsBlock = changedObjectIds.length > 0
    ? `<objects>\n${objectLines}\n    </objects>`
    : '<objects></objects>';

  return `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>NetSuite</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    ${featuresBlock}
    ${objectsBlock}
    ${filesBlock}
  </dependencies>
</manifest>`;
}
```

- [ ] **Step 4: Run tests, build, commit**

```bash
npm test -- xml && npm run build
git add ndf/src/helpers/xml.ts ndf/src/__tests__/helpers/xml.test.ts
git commit -m "feat(ndf): add XML generation helpers for deploy.xml and manifest.xml"
```

---

### Task 5: `build` command

**Files:**
- Create: `ndf/src/commands/build.ts`
- Create: `ndf/src/__tests__/commands/build.test.ts`
- Modify: `ndf/src/program.ts`

**Interfaces:**
- Consumes: `getProjectDir()`, `getMergeBase()`, `getChangedFiles()`, `generateDeployXml()`, `generateManifestXml()`, `objectIdFromPath()`
- Produces: `registerBuild(program: Command): void`

- [ ] **Step 1: Write failing tests**

`ndf/src/__tests__/commands/build.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'path';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetMergeBase = vi.hoisted(() => vi.fn());
const mockGetChangedFiles = vi.hoisted(() => vi.fn());
const mockGenerateDeployXml = vi.hoisted(() => vi.fn());
const mockGenerateManifestXml = vi.hoisted(() => vi.fn());
const mockObjectIdFromPath = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({ getProjectDir: mockGetProjectDir }));
vi.mock('../../helpers/git.js', () => ({ getMergeBase: mockGetMergeBase, getChangedFiles: mockGetChangedFiles }));
vi.mock('../../helpers/xml.js', () => ({
  generateDeployXml: mockGenerateDeployXml,
  generateManifestXml: mockGenerateManifestXml,
  objectIdFromPath: mockObjectIdFromPath,
}));
vi.mock('fs', () => ({ writeFileSync: mockWriteFileSync }));

import { registerBuild } from '../../commands/build.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerBuild(p); return p;
}

const PROJECT_DIR = '/proj/NetSuite';

beforeEach(() => {
  mockGetProjectDir.mockReturnValue(PROJECT_DIR);
  mockGetMergeBase.mockReturnValue('abc123');
  mockGetChangedFiles.mockReturnValue({
    scripts: ['src/FileCabinet/SuiteScripts/foo.js'],
    objects: ['src/Objects/customscript_bar.xml'],
  });
  mockObjectIdFromPath.mockImplementation((p: string) =>
    p.replace(/^src\/Objects\//, '').replace(/\.xml$/, ''));
  mockGenerateDeployXml.mockReturnValue('<deploy>...</deploy>');
  mockGenerateManifestXml.mockReturnValue('<manifest>...</manifest>');
});

describe('cgeaa netsuite build', () => {
  it('writes deploy.xml and manifest.xml', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'build']);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join(PROJECT_DIR, 'src', 'deploy.xml'), '<deploy>...</deploy>', 'utf-8');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join(PROJECT_DIR, 'src', 'manifest.xml'), '<manifest>...</manifest>', 'utf-8');
  });

  it('--dry-run prints XML without writing files', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'build', '--dry-run']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('<deploy>'));
    logSpy.mockRestore();
  });

  it('exits 0 with warning when no relevant files changed', async () => {
    mockGetChangedFiles.mockReturnValue({ scripts: [], objects: [] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'build'])).rejects.toThrow('exit');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No scripts or objects changed'));
    expect(exitSpy).toHaveBeenCalledWith(0);
    warnSpy.mockRestore(); exitSpy.mockRestore();
  });

  it('passes changed object IDs (not paths) to generateManifestXml', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'build']);
    expect(mockGenerateManifestXml).toHaveBeenCalledWith(
      join(PROJECT_DIR, 'src', 'manifest.xml'), ['customscript_bar']);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd ndf && npm test -- build
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ndf/src/commands/build.ts`**

```typescript
import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getProjectDir } from '../helpers/project-dir.js';
import { getMergeBase, getChangedFiles } from '../helpers/git.js';
import { generateDeployXml, generateManifestXml, objectIdFromPath } from '../helpers/xml.js';
import { output } from '../helpers/output.js';

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Generate feature-scoped deploy.xml and manifest.xml from git diff vs main')
    .option('--dry-run', 'print generated XML to stdout without writing files')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const projectDir = getProjectDir();
        const mergeBase = getMergeBase(projectDir);
        const { scripts, objects } = getChangedFiles(projectDir, mergeBase);

        if (scripts.length === 0 && objects.length === 0) {
          output.warn('No scripts or objects changed vs main — nothing to build.');
          process.exit(0);
        }

        const deployXml = generateDeployXml(scripts, objects);
        const objectIds = objects.map(objectIdFromPath);
        const manifestXml = generateManifestXml(
          join(projectDir, 'src', 'manifest.xml'), objectIds);

        if (opts.dryRun) {
          console.log('--- deploy.xml (dry run) ---');
          console.log(deployXml);
          console.log('--- manifest.xml (dry run) ---');
          console.log(manifestXml);
          return;
        }

        writeFileSync(join(projectDir, 'src', 'deploy.xml'), deployXml, 'utf-8');
        writeFileSync(join(projectDir, 'src', 'manifest.xml'), manifestXml, 'utf-8');
        output.success(
          'deploy.xml and manifest.xml updated — review and commit them to your feature branch.');
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 4: Register in `ndf/src/program.ts`**

Add `import { registerBuild } from './commands/build.js';` and call `registerBuild(program)` before `return program`.

- [ ] **Step 5: Run tests, build, commit**

```bash
npm test -- build && npm run build
git add ndf/src/commands/build.ts ndf/src/__tests__/commands/build.test.ts ndf/src/program.ts
git commit -m "feat(ndf): add build command (feature-scoped deploy.xml + manifest.xml)"
```

---

### Task 6: Production guard + `envs` command

**Files:**
- Create: `ndf/src/helpers/production-guard.ts`
- Create: `ndf/src/commands/envs.ts`
- Create: `ndf/src/__tests__/helpers/production-guard.test.ts`
- Create: `ndf/src/__tests__/commands/envs.test.ts`
- Modify: `ndf/src/program.ts`

**Interfaces:**
- Produces: `class ProductionGuardError extends Error`
- Produces: `getActiveAuthId(projectDir: string): string`
- Produces: `checkProductionGuard(projectDir: string, productionAuthId: string): void`
- Produces: `registerEnvs(program: Command): void`

- [ ] **Step 1: Write failing tests for production-guard.ts**

`ndf/src/__tests__/helpers/production-guard.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockGetCurrentBranch = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('../../helpers/git.js', () => ({ getCurrentBranch: mockGetCurrentBranch }));

import { checkProductionGuard, getActiveAuthId, ProductionGuardError } from '../../helpers/production-guard.js';

describe('getActiveAuthId', () => {
  it('reads defaultAuthId from project.json', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-Prod' }));
    expect(getActiveAuthId('/proj')).toBe('CG-Prod');
  });
});

describe('checkProductionGuard', () => {
  it('does not throw when active auth is not production', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-intQA' }));
    mockGetCurrentBranch.mockReturnValue('feature/x');
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).not.toThrow();
  });

  it('does not throw on main with production auth', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-Prod' }));
    mockGetCurrentBranch.mockReturnValue('main');
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).not.toThrow();
  });

  it('throws ProductionGuardError on feature branch with production auth', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-Prod' }));
    mockGetCurrentBranch.mockReturnValue('feature/x');
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).toThrow(ProductionGuardError);
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).toThrow('Merge your changes to main first');
  });
});
```

- [ ] **Step 2: Implement `ndf/src/helpers/production-guard.ts`**

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import { getCurrentBranch } from './git.js';

export class ProductionGuardError extends Error {
  constructor(branch: string) {
    super(
      `Cannot deploy/switch to production outside of main.\n` +
        `Current branch: ${branch}. Merge your changes to main first.`);
    this.name = 'ProductionGuardError';
  }
}

export function getActiveAuthId(projectDir: string): string {
  const raw = readFileSync(join(projectDir, 'project.json'), 'utf-8');
  return (JSON.parse(raw) as { defaultAuthId?: string }).defaultAuthId ?? '';
}

export function checkProductionGuard(projectDir: string, productionAuthId: string): void {
  if (getActiveAuthId(projectDir) !== productionAuthId) return;
  const branch = getCurrentBranch(projectDir);
  if (branch !== 'main') throw new ProductionGuardError(branch);
}
```

- [ ] **Step 3: Write failing tests for envs.ts**

`ndf/src/__tests__/commands/envs.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockGetActiveAuthId = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId }));
vi.mock('../../helpers/production-guard.js', () => ({ getActiveAuthId: mockGetActiveAuthId }));
vi.mock('child_process', () => ({ execSync: mockExecSync }));

import { registerEnvs } from '../../commands/envs.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerEnvs(p); return p;
}

// suitecloud account:manageauth --list output (ANSI codes stripped in implementation)
const MANAGEAUTH_OUTPUT =
  'CG-intQA | Administrator @ CarGurus - intQA | 3595813-sb6.app.netsuite.com\n' +
  'CG-Production | Administrator @ CarGurus\n' +
  'CG-UAT | Administrator @ CarGurus - StagingUAT | 3595813-sb1.app.netsuite.com\n';

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Production');
  mockGetActiveAuthId.mockReturnValue('CG-Production');
  mockExecSync.mockReturnValue(Buffer.from(MANAGEAUTH_OUTPUT));
});

describe('cgeaa netsuite envs', () => {
  it('prints all auth IDs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'envs']);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('CG-intQA');
    expect(out).toContain('CG-Production');
    expect(out).toContain('CG-UAT');
    logSpy.mockRestore();
  });

  it('marks active auth with *', async () => {
    mockGetActiveAuthId.mockReturnValue('CG-UAT');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'envs']);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/\*.*CG-UAT/);
    logSpy.mockRestore();
  });

  it('marks production auth with [PROD]', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeProgram().parseAsync(['node', 'ndf', 'envs']);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('[PROD]');
    logSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Implement `ndf/src/commands/envs.ts`**

```typescript
import { Command } from 'commander';
import { execSync } from 'child_process';
import { getProjectDir, getProductionAuthId } from '../helpers/project-dir.js';
import { getActiveAuthId } from '../helpers/production-guard.js';
import { output } from '../helpers/output.js';

function parseAuthIds(raw: string): string[] {
  // Strip ANSI escape codes, extract first pipe-delimited field per line
  return raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split('|')[0].trim()).filter(Boolean);
}

export function registerEnvs(program: Command): void {
  program.command('envs').description('List configured NetSuite environments').action(async () => {
    try {
      const projectDir = getProjectDir();
      const productionAuthId = getProductionAuthId();
      const activeAuthId = getActiveAuthId(projectDir);
      const raw = execSync('suitecloud account:manageauth --list', { cwd: projectDir }).toString();
      for (const id of parseAuthIds(raw)) {
        const marker = id === activeAuthId ? '*' : ' ';
        const prod = id === productionAuthId ? '  [PROD]' : '';
        console.log(`${marker} ${id}${prod}`);
      }
    } catch (err) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
}
```

- [ ] **Step 5: Register in program.ts** — add imports for `registerEnvs` and `registerBuild`; call both.

- [ ] **Step 6: Run tests, build, commit**

```bash
npm test -- production-guard envs && npm run build
git add ndf/src/helpers/production-guard.ts ndf/src/commands/envs.ts \
        ndf/src/__tests__/helpers/production-guard.test.ts \
        ndf/src/__tests__/commands/envs.test.ts ndf/src/program.ts
git commit -m "feat(ndf): add production guard and envs command"
```

---

### Task 7: `switch` command

**Files:**
- Create: `ndf/src/commands/switch-env.ts`
- Create: `ndf/src/__tests__/commands/switch-env.test.ts`
- Modify: `ndf/src/program.ts`

**Interfaces:**
- Consumes: `getProjectDir()`, `getProductionAuthId()`, `checkProductionGuard()`, `ProductionGuardError`
- Produces: `registerSwitch(program: Command): void`

- [ ] **Step 1: Write failing tests**

`ndf/src/__tests__/commands/switch-env.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'path';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockCheckProductionGuard = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId }));
vi.mock('../../helpers/production-guard.js', () => ({
  checkProductionGuard: mockCheckProductionGuard,
  ProductionGuardError: class ProductionGuardError extends Error {},
}));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync }));

import { registerSwitch } from '../../commands/switch-env.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerSwitch(p); return p;
}

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Prod');
  mockCheckProductionGuard.mockImplementation(() => {});
  mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-intQA' }));
});

describe('cgeaa netsuite switch', () => {
  it('writes new defaultAuthId to project.json', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-UAT']);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/proj', 'project.json'),
      JSON.stringify({ defaultAuthId: 'CG-UAT' }, null, '\t'),
      'utf-8');
  });

  it('calls checkProductionGuard with project dir and production auth ID', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-Prod']);
    expect(mockCheckProductionGuard).toHaveBeenCalledWith('/proj', 'CG-Prod');
  });

  it('exits 1 when production guard throws', async () => {
    mockCheckProductionGuard.mockImplementation(() => {
      throw new Error('Merge your changes to main first');
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'switch', 'CG-Prod'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Implement `ndf/src/commands/switch-env.ts`**

```typescript
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getProjectDir, getProductionAuthId } from '../helpers/project-dir.js';
import { checkProductionGuard } from '../helpers/production-guard.js';
import { output } from '../helpers/output.js';

export function registerSwitch(program: Command): void {
  program
    .command('switch <authId>')
    .description('Switch the active NetSuite environment (updates project.json defaultAuthId)')
    .action(async (authId: string) => {
      try {
        const projectDir = getProjectDir();
        checkProductionGuard(projectDir, getProductionAuthId());
        const projectJsonPath = join(projectDir, 'project.json');
        const current = JSON.parse(readFileSync(projectJsonPath, 'utf-8')) as Record<string, unknown>;
        current['defaultAuthId'] = authId;
        writeFileSync(projectJsonPath, JSON.stringify(current, null, '\t'), 'utf-8');
        output.success(`Switched to environment: ${authId}`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Register in program.ts** — add `import { registerSwitch } from './commands/switch-env.js';` and call `registerSwitch(program)`.

- [ ] **Step 4: Run tests, build, commit**

```bash
npm test -- switch && npm run build
git add ndf/src/commands/switch-env.ts ndf/src/__tests__/commands/switch-env.test.ts ndf/src/program.ts
git commit -m "feat(ndf): add switch command with production guard"
```

---

### Task 8: `deploy` command

**Files:**
- Create: `ndf/src/helpers/build-runner.ts` (extracted from build.ts)
- Create: `ndf/src/commands/deploy.ts`
- Create: `ndf/src/__tests__/commands/deploy.test.ts`
- Modify: `ndf/src/commands/build.ts` (import runBuild instead of duplicating)
- Modify: `ndf/src/__tests__/commands/build.test.ts` (mock build-runner instead of git/xml)
- Modify: `ndf/src/program.ts`

**Interfaces:**
- Produces: `interface BuildOptions { projectDir: string; dryRun: boolean }`
- Produces: `runBuild(opts: BuildOptions): Promise<void>` — the shared core logic
- Produces: `registerDeploy(program: Command): void`

- [ ] **Step 1: Extract `ndf/src/helpers/build-runner.ts`**

Move the core build logic out of `build.ts` into this helper:

```typescript
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getMergeBase, getChangedFiles } from './git.js';
import { generateDeployXml, generateManifestXml, objectIdFromPath } from './xml.js';
import { output } from './output.js';

export interface BuildOptions {
  projectDir: string;
  dryRun: boolean;
}

export async function runBuild(opts: BuildOptions): Promise<void> {
  const { projectDir, dryRun } = opts;
  const mergeBase = getMergeBase(projectDir);
  const { scripts, objects } = getChangedFiles(projectDir, mergeBase);

  if (scripts.length === 0 && objects.length === 0) {
    output.warn('No scripts or objects changed vs main — nothing to build.');
    process.exit(0);
  }

  const deployXml = generateDeployXml(scripts, objects);
  const objectIds = objects.map(objectIdFromPath);
  const manifestXml = generateManifestXml(join(projectDir, 'src', 'manifest.xml'), objectIds);

  if (dryRun) {
    console.log('--- deploy.xml (dry run) ---');
    console.log(deployXml);
    console.log('--- manifest.xml (dry run) ---');
    console.log(manifestXml);
    return;
  }

  writeFileSync(join(projectDir, 'src', 'deploy.xml'), deployXml, 'utf-8');
  writeFileSync(join(projectDir, 'src', 'manifest.xml'), manifestXml, 'utf-8');
  output.success('deploy.xml and manifest.xml updated — review and commit them to your feature branch.');
}
```

Update `ndf/src/commands/build.ts` to call `runBuild({ projectDir, dryRun: opts.dryRun ?? false })` instead of inlining the logic.

Update `ndf/src/__tests__/commands/build.test.ts` to mock `../../helpers/build-runner.js` with `{ runBuild: mockRunBuild }` and remove the git/xml mocks from that test file (they now live in `build-runner.ts`'s own tests if needed, or remain in Tasks 3/4).

- [ ] **Step 2: Write failing tests for deploy.ts**

`ndf/src/__tests__/commands/deploy.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockGetProductionAuthId = vi.hoisted(() => vi.fn());
const mockCheckProductionGuard = vi.hoisted(() => vi.fn());
const mockRunBuild = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/project-dir.js', () => ({
  getProjectDir: mockGetProjectDir, getProductionAuthId: mockGetProductionAuthId }));
vi.mock('../../helpers/production-guard.js', () => ({
  checkProductionGuard: mockCheckProductionGuard,
  ProductionGuardError: class ProductionGuardError extends Error {},
}));
vi.mock('../../helpers/build-runner.js', () => ({ runBuild: mockRunBuild }));
vi.mock('child_process', () => ({ spawnSync: mockSpawnSync }));

import { registerDeploy } from '../../commands/deploy.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerDeploy(p); return p;
}

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockGetProductionAuthId.mockReturnValue('CG-Prod');
  mockCheckProductionGuard.mockImplementation(() => {});
  mockRunBuild.mockResolvedValue(undefined);
  mockSpawnSync.mockReturnValue({ status: 0 });
});

describe('cgeaa netsuite deploy', () => {
  it('calls runBuild then spawnSync with suitecloud project:deploy', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy']);
    expect(mockRunBuild).toHaveBeenCalledWith({ projectDir: '/proj', dryRun: false });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud', ['project:deploy', '--projectdir', '/proj'], { stdio: 'inherit' });
  });

  it('--dry-run passes dryRun:true to runBuild and --dryrun to suitecloud', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'deploy', '--dry-run']);
    expect(mockRunBuild).toHaveBeenCalledWith({ projectDir: '/proj', dryRun: true });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud', ['project:deploy', '--projectdir', '/proj', '--dryrun'], { stdio: 'inherit' });
  });

  it('exits 1 when suitecloud exits non-zero', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'ndf', 'deploy'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Implement `ndf/src/commands/deploy.ts`**

```typescript
import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { getProjectDir, getProductionAuthId } from '../helpers/project-dir.js';
import { checkProductionGuard } from '../helpers/production-guard.js';
import { runBuild } from '../helpers/build-runner.js';
import { output } from '../helpers/output.js';

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Build and deploy feature changes to the active NetSuite environment')
    .option('--dry-run', 'preview deploy.xml/manifest.xml and run suitecloud --dryrun; writes nothing')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const projectDir = getProjectDir();
        checkProductionGuard(projectDir, getProductionAuthId());
        await runBuild({ projectDir, dryRun: opts.dryRun ?? false });
        const args = ['project:deploy', '--projectdir', projectDir];
        if (opts.dryRun) args.push('--dryrun');
        const result = spawnSync('suitecloud', args, { stdio: 'inherit' });
        if (result.status !== 0) {
          output.error(`suitecloud project:deploy exited with code ${result.status ?? 'unknown'}.`);
          process.exit(1);
        }
        output.success('Deploy complete.');
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 4: Register deploy in program.ts** — add `import { registerDeploy } from './commands/deploy.js';` and call `registerDeploy(program)`.

- [ ] **Step 5: Run all tests, build, commit**

```bash
npm test && npm run build
git add ndf/src/helpers/build-runner.ts ndf/src/commands/deploy.ts \
        ndf/src/__tests__/commands/deploy.test.ts \
        ndf/src/commands/build.ts ndf/src/__tests__/commands/build.test.ts \
        ndf/src/program.ts
git commit -m "feat(ndf): add deploy command; extract runBuild into build-runner helper"
```

---

### Task 9: `pull` command

**Files:**
- Create: `ndf/src/commands/pull.ts`
- Create: `ndf/src/__tests__/commands/pull.test.ts`
- Modify: `ndf/src/program.ts`

**Interfaces:**
- Consumes: `getProjectDir()`
- Produces: `registerPull(program: Command): void`

- [ ] **Step 1: Write failing tests**

`ndf/src/__tests__/commands/pull.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGetProjectDir = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/project-dir.js', () => ({ getProjectDir: mockGetProjectDir }));
vi.mock('child_process', () => ({ spawnSync: mockSpawnSync }));

import { registerPull } from '../../commands/pull.js';

function makeProgram() {
  const p = new Command(); p.exitOverride(); registerPull(p); return p;
}

beforeEach(() => {
  mockGetProjectDir.mockReturnValue('/proj');
  mockSpawnSync.mockReturnValue({ status: 0 });
});

describe('cgeaa netsuite pull object', () => {
  it('calls suitecloud object:import with correct args', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'pull', 'object', 'customscript_foo']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud',
      ['object:import', '--scriptid', 'customscript_foo',
       '--projectdir', '/proj', '--type', 'ALL', '--destinationfolder', '/Objects'],
      { stdio: 'inherit' });
  });

  it('exits 1 when suitecloud exits non-zero', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'ndf', 'pull', 'object', 'customscript_foo'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('cgeaa netsuite pull file', () => {
  it('calls suitecloud file:import with correct args', async () => {
    await makeProgram().parseAsync(['node', 'ndf', 'pull', 'file', '/SuiteScripts/foo.js']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'suitecloud',
      ['file:import', '--paths', '/SuiteScripts/foo.js', '--projectdir', '/proj'],
      { stdio: 'inherit' });
  });
});
```

- [ ] **Step 2: Implement `ndf/src/commands/pull.ts`**

```typescript
import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { getProjectDir } from '../helpers/project-dir.js';
import { output } from '../helpers/output.js';

function runSuitecloud(args: string[], projectDir: string): void {
  const result = spawnSync('suitecloud', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`suitecloud exited with code ${result.status ?? 'unknown'}.`);
  }
}

export function registerPull(program: Command): void {
  const pullCmd = program.command('pull').description('Import scripts or objects from NetSuite');

  pullCmd
    .command('object <scriptId>')
    .description('Import a custom object from NetSuite into src/Objects/')
    .action(async (scriptId: string) => {
      try {
        const projectDir = getProjectDir();
        runSuitecloud(
          ['object:import', '--scriptid', scriptId, '--projectdir', projectDir,
           '--type', 'ALL', '--destinationfolder', '/Objects'],
          projectDir);
        output.success(`Object ${scriptId} imported.`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  pullCmd
    .command('file <path>')
    .description('Import a file from the NetSuite File Cabinet')
    .action(async (filePath: string) => {
      try {
        const projectDir = getProjectDir();
        runSuitecloud(
          ['file:import', '--paths', filePath, '--projectdir', projectDir],
          projectDir);
        output.success(`File ${filePath} imported.`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Register in program.ts** — add `import { registerPull } from './commands/pull.js';` and call `registerPull(program)`.

- [ ] **Step 4: Run tests, build, commit**

```bash
npm test -- pull && npm run build
git add ndf/src/commands/pull.ts ndf/src/__tests__/commands/pull.test.ts ndf/src/program.ts
git commit -m "feat(ndf): add pull object and pull file commands"
```

---

### Task 10: `setup` command + cgeaa-setup integration

**Files:**
- Create: `ndf/src/commands/setup.ts`
- Modify: `ndf/src/program.ts`
- Modify: `cgeaa-setup`

**Interfaces:**
- Consumes: `writeCgeaaConfigKey()`, `readCgeaaConfig()`
- Produces: `registerSetup(program: Command): void`
- Note: interactive portions (readline prompts, suitecloud account:setup spawn) are not unit-tested. Config writing/validation is covered by Task 2 tests.

- [ ] **Step 1: Implement `ndf/src/commands/setup.ts`**

```typescript
import { Command } from 'commander';
import { createInterface } from 'readline';
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { writeCgeaaConfigKey } from '../helpers/config.js';
import { output } from '../helpers/output.js';

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function listAuthIds(): string[] {
  try {
    const raw = execSync('suitecloud account:manageauth --list').toString();
    return raw
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => l.split('|')[0].trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function registerSetup(program: Command): void {
  program
    .command('setup')
    .description('Configure cgeaa netsuite for this machine')
    .action(async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        // Step 1: project dir
        const dir = await prompt(rl,
          'Enter the absolute path to your SDF project root (containing suitecloud.config.js): ');
        const trimmedDir = dir.trim();
        if (!existsSync(join(trimmedDir, 'suitecloud.config.js'))) {
          output.error(`suitecloud.config.js not found at ${trimmedDir}. Check the path and re-run setup.`);
          process.exit(1);
        }
        writeCgeaaConfigKey('netsuite_project_dir', trimmedDir);
        output.success(`netsuite_project_dir set to: ${trimmedDir}`);

        // Step 2: show or create auth IDs
        let authIds = listAuthIds();
        if (authIds.length === 0) {
          output.info('No suitecloud auth IDs found. Launching suitecloud account:setup...');
          spawnSync('suitecloud', ['account:setup'], { stdio: 'inherit' });
          authIds = listAuthIds();
          if (authIds.length === 0) {
            output.error('Still no auth IDs configured. Re-run cgeaa netsuite setup when ready.');
            process.exit(1);
          }
        }
        output.info('Configured suitecloud auth IDs:');
        authIds.forEach((id, i) => console.log(`  ${i + 1}. ${id}`));

        // Step 3: pick production
        const prodAnswer = await prompt(rl, 'Which auth ID is production? Enter the exact auth ID: ');
        const prodId = prodAnswer.trim();
        if (!authIds.includes(prodId)) {
          output.error(`"${prodId}" not found. Re-run setup and enter an exact ID from the list.`);
          process.exit(1);
        }
        writeCgeaaConfigKey('netsuite_production_auth_id', prodId);
        output.success(`netsuite_production_auth_id set to: ${prodId}`);
        output.success('NetSuite setup complete. Run "cgeaa netsuite envs" to verify.');
      } finally {
        rl.close();
      }
    });
}
```

- [ ] **Step 2: Register in program.ts** — add `import { registerSetup } from './commands/setup.js';` and call `registerSetup(program)`.

- [ ] **Step 3: Add optional NetSuite section to `cgeaa-setup`**

Find `install_zdf_globally` in `cgeaa-setup`. Add `install_ndf_globally` immediately after it:

```bash
install_ndf_globally() {
    local ndf_source="${SCRIPT_DIR}/ndf"
    [ -d "$ndf_source" ] || return 0  # NDF not present in this install
    if ! (cd "$ndf_source" && npm install --silent && npm run build --silent 2>/dev/null); then
        log_warn "NDF build failed — 'cgeaa netsuite' will build on first use."
        return 0
    fi
    log_success "NDF built successfully."
}
```

In `perform_global_install`, add a call to it after `install_zdf_globally`:

```bash
    # 2c. Build NetSuite Development Framework (soft dependency)
    install_ndf_globally
```

Find the interactive setup section that prompts for Zuora credentials. After it, add:

```bash
setup_netsuite_optional() {
    echo
    echo -e "${YELLOW}--- NetSuite Setup (optional) ---${NC}"
    read -p "Do you use NetSuite? Set up 'cgeaa netsuite' now? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping. Run 'cgeaa netsuite setup' any time to configure."
        return
    fi
    local ndf_bin="${SCRIPT_DIR}/ndf/dist/ndf.js"
    if [ -f "$ndf_bin" ]; then
        node "$ndf_bin" setup
    else
        echo "NDF not built yet. Run 'cgeaa netsuite setup' after setup completes."
    fi
}
```

Call `setup_netsuite_optional` from the interactive setup flow.

- [ ] **Step 4: Run all tests, build, commit**

```bash
cd ndf && npm test && npm run build
git add ndf/src/commands/setup.ts ndf/src/program.ts cgeaa-setup
git commit -m "feat(ndf): add setup command and cgeaa-setup integration"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `ndf/` TypeScript CLI mirroring zdf/ | 1 |
| `cgeaa-lib/netsuite.sh` dispatch + cgeaa wiring | 1 |
| `netsuite_project_dir` + `netsuite_production_auth_id` config | 2 |
| Fail-fast with "run setup" message if config missing | 2 |
| `getMergeBase` / `getChangedFiles` / `getCurrentBranch` | 3 |
| `.attributes` and `node_modules` excluded from scripts | 3 |
| `generateDeployXml`: targeted paths, `<configuration>` always present, sections omitted when empty | 4 |
| `generateManifestXml`: preserves `<features>` + `<files>`, feature-only `<objects>` | 4 |
| `objectIdFromPath` | 4 |
| `build --dry-run` | 5 |
| "No changes" warning + exit 0 | 5 |
| `ProductionGuardError` + `checkProductionGuard` | 6 |
| `envs` marks active (*) and production ([PROD]) | 6 |
| `switch` writes project.json, guards production | 7 |
| `deploy` calls build then suitecloud, production guard | 8 |
| `deploy --dry-run` passes through to both build and suitecloud | 8 |
| `pull object <scriptId>` | 9 |
| `pull file <path>` | 9 |
| `setup` interactive, saves both config keys, handles no-existing-auths | 10 |
| `cgeaa-setup` optional NetSuite section | 10 |

All spec requirements covered. No TBD/TODO/placeholder steps. Type names consistent across tasks (`ChangedFiles`, `BuildOptions`, `NdfConfigError`, `ProductionGuardError`, `registerBuild/registerEnvs/registerSwitch/registerDeploy/registerPull/registerSetup`).
