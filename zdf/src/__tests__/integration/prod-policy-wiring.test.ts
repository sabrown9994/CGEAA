import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// End-to-end wiring test for the production write policy. It drives the REAL
// `buildProgram()` (options + preAction hook + command registrations) so that a
// regression in the glue — removing the `program.hook('preAction', ...)`, swapping
// verb/resource, or breaking the `opts.allowProdFinancial`/`opts.yes` plumbing —
// fails a test rather than slipping through (the unit tests only cover the pure
// `decideProductionPolicy` / `confirmProduction` pieces in isolation).
//
// The distinguishing case is `--yes delete account` WITHOUT `--allow-prod-financial`:
// with the hook it BLOCKS (financial write to prod); if the hook were removed,
// `getInvokedCommand()` would return null and the fail-safe path would honor `--yes`
// and PROCEED — so this assertion catches hook loss specifically.

// Active env is a PRODUCTION tenant for every case here.
const mockGetActiveEnv = vi.hoisted(() =>
  vi.fn(() => ({ isProduction: true, name: 'prod', type: 'CI', baseUrl: 'http://127.0.0.1:9', clientId: 'x', clientSecret: 'y' }))
);
vi.mock('../../auth/config.js', () => ({ getActiveEnv: mockGetActiveEnv }));

const mockEnsureToken = vi.hoisted(() => vi.fn().mockResolvedValue('tok'));
vi.mock('../../auth/token.js', () => ({ ensureToken: mockEnsureToken }));

// API layer fully mocked so allowed cases never touch the network.
const mockApiGet = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockApiPost = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
const mockApiPut = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockApiDelete = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
const mockApiQuery = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../../api/client.js', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
  apiDelete: mockApiDelete,
  apiQuery: mockApiQuery,
  setDebug: vi.fn(),
  setMaxRows: vi.fn(),
  APIQUERY_MAX_ROWS: 5000,
}));

// Dependency graph mocked so allowed reads/deletes don't fetch or write files.
const mockResolveAndSync = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolveAndSync,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn(() => false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  getMaxItems: vi.fn(() => 5000),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

// File I/O mocked so nothing hits disk (getOutputDir runs at registration time).
vi.mock('../../helpers/file-io.js', () => ({
  getOutputDir: vi.fn(() => 'zdf-output'),
  resolveFilePath: vi.fn(() => 'zdf-output/x.json'),
  readResourceFile: vi.fn(() => ({ name: 'x' })),
  writeResourceFile: vi.fn(),
  renameResourceFile: vi.fn(),
  deleteResourceFile: vi.fn(),
}));

// inquirer only reached on the interactive-confirm path (not exercised here since
// every allowed case passes --yes) — stub it so an accidental prompt can't hang.
const mockPrompt = vi.hoisted(() => vi.fn().mockResolvedValue({ confirmed: true }));
vi.mock('inquirer', () => ({ default: { prompt: mockPrompt } }));

// Silence + spy on output.
const mockError = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/output.js', () => ({
  output: { success: vi.fn(), info: vi.fn(), warn: mockWarn, error: mockError },
}));

import { buildProgram } from '../../program.js';
import { resetInvokedCommand } from '../../helpers/command-policy.js';

class ProcessExit extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}
const exitSpy = vi
  .spyOn(process, 'exit')
  .mockImplementation(((code?: number) => {
    throw new ProcessExit(code ?? 0);
  }) as never);

async function run(argv: string[]): Promise<number> {
  // Returns the process.exit code (0 if the command completed without exiting).
  try {
    await buildProgram().parseAsync(['node', 'zdf', ...argv]);
    return 0;
  } catch (e) {
    if (e instanceof ProcessExit) return e.code;
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveEnv.mockReturnValue({ isProduction: true, name: 'prod', type: 'CI', baseUrl: 'http://127.0.0.1:9', clientId: 'x', clientSecret: 'y' });
  resetInvokedCommand();
});

afterAll(() => {
  exitSpy.mockRestore();
});

describe('production write policy — end-to-end through buildProgram()', () => {
  it('BLOCKS a financial write on prod even with --yes (no --allow-prod-financial): no API call, exit 1', async () => {
    // Distinguishing case: if the preAction hook were removed, invoked would be null,
    // the fail-safe would honor --yes and PROCEED (apiDelete called). It must NOT.
    const code = await run(['--yes', 'delete', 'account', 'A1']);
    expect(code).toBe(1);
    expect(mockApiDelete).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalled();
    expect(mockError.mock.calls.some((c) => /financial/i.test(String(c[0])))).toBe(true);
  });

  it('ALLOWS a financial write on prod with --allow-prod-financial --yes: API call happens', async () => {
    const code = await run(['--allow-prod-financial', '--yes', 'delete', 'account', 'A1']);
    expect(code).toBe(0);
    expect(mockApiDelete).toHaveBeenCalledWith('/v1/accounts/A1');
  });

  it('ALLOWS a read (pull) on prod with no flags: no block, resolveAndSync runs', async () => {
    const code = await run(['pull', 'account', 'A1']);
    expect(code).toBe(0);
    expect(mockResolveAndSync).toHaveBeenCalledWith('account', 'A1', 'pull');
    expect(mockError).not.toHaveBeenCalled();
  });

  it('ALLOWS a config write (push workflow) on prod with --yes: gets past policy to the API', async () => {
    const code = await run(['--yes', 'push', 'workflow', 'W1']);
    expect(code).toBe(0);
    expect(mockApiPut).toHaveBeenCalledWith('/workflows/W1', expect.anything());
    // Not blocked as financial:
    expect(mockError).not.toHaveBeenCalled();
  });
});
