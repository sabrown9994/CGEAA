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

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
    existsSync: mockExistsSync,
  };
});

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

vi.mock('../../helpers/output.js', () => ({
  output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { register, nextWorkflowVersion } from '../../commands/workflows.js';
import { output } from '../../helpers/output.js';

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

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
});

describe('zdf pull workflow', () => {
  it('fetches the FULL definition via /export and writes it (definition ID)', async () => {
    // FIX 2: Resolver reads active version ID directly from export body (no separate /versions call)
    mockGet
      .mockResolvedValueOnce({ ...EXPORT })  // resolveWorkflow: /workflows/123/export succeeds
      .mockResolvedValueOnce({ ...EXPORT });  // pull: /workflows/123/export again (active version)
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '123']);
    // Filename is now sanitized name + definition ID
    expect(mockWrite).toHaveBeenCalledWith('workflow', 'My_WF_123', expect.objectContaining({ tasks: expect.any(Array), linkages: expect.any(Array) }));
  });

  it('fetches by version ID (active version)', async () => {
    // Resolver: version ID path (active)
    mockGet
      .mockRejectedValueOnce(new Error('Workflow definition not found'))  // resolveWorkflow: /workflows/978174/export fails
      .mockResolvedValueOnce({ id: 978174, definitionId: 123, version: '1.0', status: 'Active' })  // resolveWorkflow: /workflows/978174
      .mockResolvedValueOnce({ data: [{ id: 978174, status: 'Active' }] })  // resolveWorkflow: /workflows/123/versions
      .mockResolvedValueOnce({ ...EXPORT });  // pull: /workflows/123/export (active)
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '978174']);
    expect(mockWrite).toHaveBeenCalledWith('workflow', 'My_WF_123', expect.objectContaining({ tasks: expect.any(Array) }));
  });

  it('fetches an older version by version ID', async () => {
    // Resolver: version ID path (inactive)
    const olderExport = { ...EXPORT, workflow: { ...EXPORT.workflow, id: 978173, description: 'v0.9' } };
    mockGet
      .mockRejectedValueOnce(new Error('not found'))  // resolveWorkflow: /workflows/978173/export fails
      .mockResolvedValueOnce({ id: 978173, definitionId: 123, version: '0.9', status: 'Inactive' })  // resolveWorkflow: /workflows/978173
      .mockResolvedValueOnce({ data: [{ id: 978174, status: 'Active' }] })  // resolveWorkflow: /workflows/123/versions
      .mockResolvedValueOnce(olderExport);  // pull: /workflows/123/export?version=0.9
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '978173']);
    expect(mockGet).toHaveBeenCalledWith('/workflows/123/export?version=0.9');
    expect(mockWrite).toHaveBeenCalledWith('workflow', 'My_WF_123', expect.objectContaining({ workflow: expect.objectContaining({ id: 978173 }) }));
  });

  it('throws clear error when neither definition nor version ID resolves', async () => {
    mockGet
      .mockRejectedValueOnce(new Error('not found'))  // resolveWorkflow: /export fails
      .mockRejectedValueOnce(new Error('not found'));  // resolveWorkflow: /workflows/{id} fails
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '999'])
    ).rejects.toThrow('exit');
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('No workflow or version found for ID 999 in tenant sandbox'));
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
    // FIX 1: Setup fs mocks for findLocalFile
    mockReaddirSync.mockReturnValue(['123.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(EXPORT));

    // FIX 2: Resolver reads active version ID directly from export body (no separate /versions call)
    mockGet
      .mockResolvedValueOnce({ ...EXPORT })  // resolveWorkflow: /workflows/123/export succeeds
      .mockResolvedValueOnce({ data: [{ version: '1.0' }, { version: '2.0' }] });  // nextWorkflowVersion: /workflows/123/versions
    // versions/import returns the workflow object directly (no {success} envelope).
    mockPost.mockResolvedValue({ id: 123, active_version: { version: '3.0' } });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '123']);
    expect(mockPost).toHaveBeenCalledWith(
      '/workflows/123/versions/import?version=3.0&activate=true',
      expect.objectContaining({ tasks: expect.any(Array), linkages: expect.any(Array) })
    );
  });

  it('accepts a version ID and resolves to the definition ID', async () => {
    // FIX 1: Setup fs mocks for findLocalFile
    mockReaddirSync.mockReturnValue(['123.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(EXPORT));

    // Resolver: version ID → definition 123
    mockGet
      .mockRejectedValueOnce(new Error('not found'))  // resolveWorkflow: /workflows/978174/export fails
      .mockResolvedValueOnce({ id: 978174, definitionId: 123, version: '2.0', status: 'Active' })  // resolveWorkflow: /workflows/978174
      .mockResolvedValueOnce({ data: [{ id: 978174, status: 'Active' }] })  // resolveWorkflow: /workflows/123/versions
      .mockResolvedValueOnce({ data: [{ version: '2.0' }] });  // nextWorkflowVersion: /workflows/123/versions
    mockPost.mockResolvedValue({ id: 123 });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '978174']);
    // Should push to definition 123, not version 978174
    expect(mockPost).toHaveBeenCalledWith(
      '/workflows/123/versions/import?version=3.0&activate=true',
      expect.any(Object)
    );
  });

  it('honors --version and --no-activate', async () => {
    // FIX 1: Setup fs mocks for findLocalFile
    mockReaddirSync.mockReturnValue(['123.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(EXPORT));

    // FIX 2: Resolver reads active version ID directly from export body
    mockGet.mockResolvedValueOnce({ ...EXPORT });  // resolveWorkflow: /workflows/123/export
    mockPost.mockResolvedValue({ id: 123 });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '123', '--version', '9.9', '--no-activate']);
    // explicit --version skips nextWorkflowVersion, so no second mockGet call
    expect(mockPost).toHaveBeenCalledWith(
      '/workflows/123/versions/import?version=9.9&activate=false',
      expect.any(Object)
    );
  });

  it('FIX 1: pull→push round-trip finds the pull-written filename (definition ID)', async () => {
    // Simulate pull having written My_WF_610197.json (the real pull filename format)
    const pullWrittenFile = 'My_WF_610197.json';
    mockReaddirSync.mockReturnValue([pullWrittenFile, 'some_other_file.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(EXPORT));

    // Resolver: definition ID
    mockGet
      .mockResolvedValueOnce({ ...EXPORT })  // resolveWorkflow: /workflows/610197/export
      .mockResolvedValueOnce({ data: [{ version: '1.0' }] });  // nextWorkflowVersion: /workflows/610197/versions
    mockPost.mockResolvedValue({ id: 610197 });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '610197']);

    // Should have scanned the directory and found the _610197.json file
    expect(mockReaddirSync).toHaveBeenCalledWith('MOCK_OUTPUT/workflows');
    expect(mockReadFileSync).toHaveBeenCalledWith('MOCK_OUTPUT/workflows/My_WF_610197.json', 'utf-8');
    expect(mockPost).toHaveBeenCalledWith(
      '/workflows/610197/versions/import?version=2.0&activate=true',
      expect.objectContaining({ tasks: expect.any(Array) })
    );
  });

  it('FIX 1: pull→push round-trip finds the pull-written filename (version ID → definition ID)', async () => {
    // Simulate pull having written My_WF_610197.json
    const pullWrittenFile = 'My_WF_610197.json';
    mockReaddirSync.mockReturnValue([pullWrittenFile]);
    mockReadFileSync.mockReturnValue(JSON.stringify(EXPORT));

    // Resolver: version ID → definition 610197
    mockGet
      .mockRejectedValueOnce(new Error('not found'))  // resolveWorkflow: /workflows/2083376/export fails
      .mockResolvedValueOnce({ id: 2083376, definitionId: 610197, version: '6.0', status: 'Active' })  // resolveWorkflow: /workflows/2083376
      .mockResolvedValueOnce({ data: [{ id: 2083376, status: 'Active' }] })  // resolveWorkflow: /workflows/610197/versions
      .mockResolvedValueOnce({ data: [{ version: '6.0' }] });  // nextWorkflowVersion: /workflows/610197/versions
    mockPost.mockResolvedValue({ id: 610197 });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '2083376']);

    // Should have resolved to definition 610197 and found its file
    expect(mockReaddirSync).toHaveBeenCalledWith('MOCK_OUTPUT/workflows');
    expect(mockReadFileSync).toHaveBeenCalledWith('MOCK_OUTPUT/workflows/My_WF_610197.json', 'utf-8');
    expect(mockPost).toHaveBeenCalledWith(
      '/workflows/610197/versions/import?version=7.0&activate=true',
      expect.any(Object)
    );
  });

  it('FIX 1: also finds create-written filename format (<id>.json)', async () => {
    // Simulate create having written 610197.json (the create/rename format)
    mockReaddirSync.mockReturnValue(['610197.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(EXPORT));

    // Resolver: definition ID
    mockGet
      .mockResolvedValueOnce({ ...EXPORT })  // resolveWorkflow: /workflows/610197/export
      .mockResolvedValueOnce({ data: [{ version: '1.0' }] });  // nextWorkflowVersion
    mockPost.mockResolvedValue({ id: 610197 });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'workflow', '610197']);

    // Should have found the exact-match file
    expect(mockReadFileSync).toHaveBeenCalledWith('MOCK_OUTPUT/workflows/610197.json', 'utf-8');
  });
});

describe('zdf delete workflow', () => {
  it('deletes via /workflows/{definitionId} (definition ID input)', async () => {
    // FIX 2: Resolver reads active version ID directly from export body
    mockGet.mockResolvedValueOnce({ ...EXPORT });  // resolveWorkflow: /workflows/123/export
    mockDelete.mockResolvedValue({ success: true, id: 123 });
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'workflow', '123']);
    expect(mockDelete).toHaveBeenCalledWith('/workflows/123');
  });

  it('accepts a version ID and resolves to the definition ID before deleting', async () => {
    // Resolver: version ID
    mockGet
      .mockRejectedValueOnce(new Error('not found'))  // resolveWorkflow: /workflows/978174/export fails
      .mockResolvedValueOnce({ id: 978174, definitionId: 123, version: '1.0', status: 'Active' })  // resolveWorkflow: /workflows/978174
      .mockResolvedValueOnce({ data: [{ id: 978174, status: 'Active' }] });  // resolveWorkflow: /workflows/123/versions
    mockDelete.mockResolvedValue({ success: true, id: 123 });
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'workflow', '978174']);
    // Should delete definition 123, not version 978174
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

describe('zdf list workflows', () => {
  it('fetches a single page and prints all workflows with success count', async () => {
    mockGet.mockResolvedValue({
      data: [
        { id: 1, name: 'Workflow A', status: 'Active', active_version: { version: '1.0' } },
        { id: 2, name: 'Workflow B', status: 'Draft', active_version: { version: '2.1' } },
      ],
      pagination: { page: 1, page_length: 50, total_count: 2, next_page: null },
    });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows']);

    expect(mockGet).toHaveBeenCalledWith('/workflows?page=1&page_length=50');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(output.info).toHaveBeenCalledWith('1  Workflow A  Active  v1.0');
    expect(output.info).toHaveBeenCalledWith('2  Workflow B  Draft  v2.1');
    expect(output.success).toHaveBeenCalledWith('Fetched 2 workflows.');
  });

  it('paginates across multiple pages by page number', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `WF ${i + 1}`, status: 'Active' })),
        pagination: { page: 1, page_length: 50, total_count: 75, next_page: 'https://example.com/workflows?page=2' },
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 25 }, (_, i) => ({ id: i + 51, name: `WF ${i + 51}`, status: 'Active' })),
        pagination: { page: 2, page_length: 50, total_count: 75, next_page: null },
      });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows']);

    expect(mockGet).toHaveBeenCalledWith('/workflows?page=1&page_length=50');
    expect(mockGet).toHaveBeenCalledWith('/workflows?page=2&page_length=50');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(output.info).toHaveBeenCalledTimes(75);
    expect(output.success).toHaveBeenCalledWith('Fetched 75 workflows.');
  });

  it('handles empty data and prints success with 0 count', async () => {
    mockGet.mockResolvedValue({
      data: [],
      pagination: { page: 1, page_length: 50, total_count: 0, next_page: null },
    });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows']);

    expect(mockGet).toHaveBeenCalledWith('/workflows?page=1&page_length=50');
    expect(output.info).not.toHaveBeenCalled();
    expect(output.success).toHaveBeenCalledWith('Fetched 0 workflows.');
  });

  it('handles missing optional fields gracefully', async () => {
    mockGet.mockResolvedValue({
      data: [
        { id: 1 },
        { id: 2, name: 'Named WF' },
        { id: 3, name: 'WF with Status', status: 'Draft' },
        { id: 4, name: 'WF with Version', active_version: { version: '3.5' } },
      ],
      pagination: { page: 1, page_length: 50, total_count: 4 },
    });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows']);

    expect(output.info).toHaveBeenCalledWith('1      v?');
    expect(output.info).toHaveBeenCalledWith('2  Named WF    v?');
    expect(output.info).toHaveBeenCalledWith('3  WF with Status  Draft  v?');
    expect(output.info).toHaveBeenCalledWith('4  WF with Version    v3.5');
    expect(output.success).toHaveBeenCalledWith('Fetched 4 workflows.');
  });

  it('stops when accumulated length reaches total_count', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `WF ${i + 1}` })),
        pagination: { page: 1, page_length: 50, total_count: 50 },
      });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows']);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(output.success).toHaveBeenCalledWith('Fetched 50 workflows.');
  });

  it('warns and stops when hitting the 5000-workflow safety cap', async () => {
    // Simulate paginating to the cap
    mockGet.mockImplementation(async (path: string) => {
      const match = path.match(/page=(\d+)/);
      const page = match ? parseInt(match[1], 10) : 1;
      return {
        data: Array.from({ length: 50 }, (_, i) => ({ id: (page - 1) * 50 + i + 1, name: `WF ${(page - 1) * 50 + i + 1}` })),
        pagination: { page, page_length: 50, total_count: 10000, next_page: 'next' },
      };
    });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows']);

    // Should fetch exactly 100 pages (100 * 50 = 5000 workflows)
    expect(mockGet).toHaveBeenCalledTimes(100);
    expect(output.warn).toHaveBeenCalledWith(
      expect.stringContaining('hit the 5000-workflow safety cap')
    );
    expect(output.success).toHaveBeenCalledWith('Fetched 5000 workflows.');
  });

  it('throws with clear error when data field is non-array', async () => {
    mockGet.mockResolvedValue({
      data: 'oops',
      pagination: { page: 1, page_length: 50 },
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows'])
    ).rejects.toThrow('exit');
    expect(output.error).toHaveBeenCalledWith(
      expect.stringContaining('non-array data field')
    );
    exitSpy.mockRestore();
  });

  it('warns when hitting the 200-page limit with more workflows remaining', async () => {
    // Simulate pagination that never completes - returns 20 items per page so we hit page cap before workflow cap
    // (200 pages * 20 = 4000 workflows < 5000 MAX_WORKFLOWS)
    mockGet.mockImplementation(async (path: string) => {
      const match = path.match(/page=(\d+)/);
      const page = match ? parseInt(match[1], 10) : 1;
      return {
        data: Array.from({ length: 20 }, (_, i) => ({ id: (page - 1) * 20 + i + 1, name: `WF ${(page - 1) * 20 + i + 1}` })),
        pagination: { page, page_length: 20, total_count: 50000, next_page: 'next' },
      };
    });

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'workflows']);

    // Should fetch exactly 200 pages (the MAX_PAGES cap)
    expect(mockGet).toHaveBeenCalledTimes(200);
    expect(output.warn).toHaveBeenCalledWith(
      expect.stringMatching(/hit the 200-page limit.*returning 4000 workflows.*server indicated 50000 total/)
    );
    expect(output.success).toHaveBeenCalledWith('Fetched 4000 workflows.');
  });
});
