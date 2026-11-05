import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Only the network layer and auth/production guards are mocked here — file-io.js is
// the REAL module, so this test exercises the actual ZDF_OUTPUT_DIR override behavior
// that resolveFilePath()/getOutputDir() depend on (see file-io.ts).
const mockGet = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));
vi.mock('../../helpers/dependency-graph.js', () => ({
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

import { register } from '../../commands/workflows.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

const testOutputDir = join(os.tmpdir(), `zdf-output-path-test-${Date.now()}`);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ZDF_OUTPUT_DIR = testOutputDir;
});

afterEach(() => {
  delete process.env.ZDF_OUTPUT_DIR;
  if (existsSync(testOutputDir)) rmSync(testOutputDir, { recursive: true });
});

describe('success message paths honor ZDF_OUTPUT_DIR', () => {
  it('prints the overridden output dir, not the hardcoded zdf-output/ default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // FIX 2: Resolver reads active version ID directly from export body (no separate /versions call)
    mockGet
      .mockResolvedValueOnce({ workflow_definition: { name: 'My Workflow' }, workflow: { id: 456, name: 'My Workflow' }, tasks: [], linkages: [] })  // resolveWorkflow: /workflows/123/export
      .mockResolvedValueOnce({ workflow_definition: { name: 'My Workflow' }, workflow: { id: 456, name: 'My Workflow' }, tasks: [], linkages: [] });  // pull: /workflows/123/export

    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '123']);

    const printed = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    // Filename is now sanitized name + definition ID
    expect(printed).toContain(join(testOutputDir, 'workflows', 'My_Workflow_123.json'));
    expect(printed).not.toContain('zdf-output/workflows/');

    logSpy.mockRestore();
  });
});
