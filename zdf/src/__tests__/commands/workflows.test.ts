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

import { register, nextWorkflowVersion } from '../../commands/workflows.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

// A minimal but representative /export payload.
const EXPORT = {
  workflow_definition: { name: 'My WF', description: 'desc', category: 'Default' },
  workflow: {
    id: 978174, name: 'My WF', description: 'v1',
    ondemand_trigger: true, callout_trigger: false, scheduled_trigger: false,
    interval: '', timezone: 'UTC', priority: 'Medium', status: 'Active',
  },
  tasks: [{ id: 1 }],
  linkages: [{ id: 2 }],
};

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull workflow', () => {
  it('fetches the FULL definition via /export and writes it', async () => {
    mockGet.mockResolvedValue({ ...EXPORT });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '123']);
    expect(mockGet).toHaveBeenCalledWith('/workflows/123/export');
    expect(mockWrite).toHaveBeenCalledWith('workflow', '123', expect.objectContaining({ tasks: expect.any(Array), linkages: expect.any(Array) }));
  });

  it('does not write and exits non-zero when the export returns 200-with-errors', async () => {
    mockGet.mockResolvedValue({ success: false, reasons: [{ code: 58230015, message: 'Object not found.' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '999'])
    ).rejects.toThrow('exit');
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf create workflow', () => {
  it('imports via POST /workflows/import and renames the file to the new definition id', async () => {
    mockRead.mockReturnValue({ ...EXPORT });
    // Import returns the created workflow object directly (no {success} envelope).
    mockPost.mockResolvedValue({ id: 2327557, definitionId: 2327557, name: 'My WF' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'workflow', 'my-draft']);
    expect(mockPost).toHaveBeenCalledWith('/workflows/import', expect.objectContaining({ tasks: expect.any(Array) }));
    expect(mockRename).toHaveBeenCalledWith('workflow', 'my-draft', '2327557');
  });
});

describe('zdf push workflow', () => {
  it('imports the edited definition as a new active version (auto-bumped above the latest)', async () => {
    mockRead.mockReturnValue({ ...EXPORT });
    // nextWorkflowVersion() reads the versions list; latest major is 2 -> next is 3.0.
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/workflows/123/versions') return { data: [{ version: '1.0' }, { version: '2.0' }] };
      return {};
    });
    // versions/import returns the workflow object directly (no {success} envelope).
    mockPost.mockResolvedValue({ id: 123, active_version: { version: '3.0' } });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '123']);
    expect(mockGet).toHaveBeenCalledWith('/workflows/123/versions');
    expect(mockPost).toHaveBeenCalledWith(
      '/workflows/123/versions/import?version=3.0&activate=true',
      expect.objectContaining({ tasks: expect.any(Array), linkages: expect.any(Array) })
    );
  });

  it('honors --version and --no-activate', async () => {
    mockRead.mockReturnValue({ ...EXPORT });
    mockPost.mockResolvedValue({ id: 123 });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '123', '--version', '9.9', '--no-activate']);
    // explicit --version skips the versions lookup
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith(
      '/workflows/123/versions/import?version=9.9&activate=false',
      expect.any(Object)
    );
  });
});

describe('zdf delete workflow', () => {
  it('deletes via /workflows/{id} and requires the {success} envelope', async () => {
    mockDelete.mockResolvedValue({ success: true, id: 123 });
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'workflow', '123']);
    expect(mockDelete).toHaveBeenCalledWith('/workflows/123');
  });
});

describe('nextWorkflowVersion', () => {
  it('bumps the highest existing major and returns <major+1>.0', async () => {
    mockGet.mockResolvedValue({ data: [{ version: '1.0' }, { version: '2.3' }, { version: '2.0' }] });
    expect(await nextWorkflowVersion('123')).toBe('3.0');
  });

  it('falls back to 1.0 when there are no versions', async () => {
    mockGet.mockResolvedValue({ data: [] });
    expect(await nextWorkflowVersion('123')).toBe('1.0');
  });
});
