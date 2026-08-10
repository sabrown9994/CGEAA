import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT') }));

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

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull workflow', () => {
  it('fetches from the corrected /workflows base path', async () => {
    mockGet.mockResolvedValue({ id: 123, name: 'My Workflow' });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '123']);
    expect(mockGet).toHaveBeenCalledWith('/workflows/123');
  });

  it('writes the file when the body has no success field (valid workflow object)', async () => {
    mockGet.mockResolvedValue({ id: 123, name: 'My Workflow' });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '123']);
    expect(mockWrite).toHaveBeenCalledWith('workflow', '123', expect.objectContaining({ id: 123 }));
  });

  it('does not write and exits non-zero when Zuora returns 200-with-reasons', async () => {
    mockGet.mockResolvedValue({
      success: false,
      reasons: [{ code: 58230015, message: 'Object not found.' }],
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '999'])
    ).rejects.toThrow('exit');
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf create workflow', () => {
  it('posts to the corrected /workflows base path', async () => {
    mockRead.mockReturnValue({ name: 'New Workflow' });
    mockPost.mockResolvedValue({ success: true, id: 456 });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'workflow', 'my-draft']);
    expect(mockPost).toHaveBeenCalledWith('/workflows', { name: 'New Workflow' });
    expect(mockRename).toHaveBeenCalledWith('workflow', 'my-draft', '456');
  });
});

describe('zdf push workflow', () => {
  it('puts to the corrected /workflows/{id} path', async () => {
    mockRead.mockReturnValue({ name: 'My Workflow' });
    // Workflows API PUT returns the workflow object directly (no {success} envelope)
    mockPut.mockResolvedValue({ id: 123, name: 'My Workflow', status: 'Active' });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '123']);
    expect(mockPut).toHaveBeenCalledWith('/workflows/123', expect.any(Object));
  });
});

describe('zdf delete workflow', () => {
  it('deletes via the corrected /workflows/{id} path', async () => {
    // Workflows API DELETE returns no {success} envelope on success (empty or 204)
    mockDelete.mockResolvedValue({});
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'workflow', '123']);
    expect(mockDelete).toHaveBeenCalledWith('/workflows/123');
  });
});
