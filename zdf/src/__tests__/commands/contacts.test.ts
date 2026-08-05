import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT') }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: mockReadFileSync };
});

import { register } from '../../commands/contacts.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull contact', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'contact', 'con-1']);
    expect(mockResolve).toHaveBeenCalledWith('contact', 'con-1', 'pull');
  });
});

describe('zdf create contact', () => {
  it('reads local file, posts to Zuora, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ firstName: 'Jane' });
    mockPost.mockResolvedValue({ Id: 'new-contact-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'contact', 'my-draft']);
    expect(mockPost).toHaveBeenCalledWith('/v1/contacts', { firstName: 'Jane' });
    expect(mockRename).toHaveBeenCalledWith('contact', 'my-draft', 'new-contact-id');
  });

  it('reads from --file path and skips rename', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ firstName: 'John' }));
    mockPost.mockResolvedValue({ Id: 'new-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'contact', 'my-contact', '--file', '/tmp/contact.json']);
    expect(mockPost).toHaveBeenCalledWith('/v1/contacts', { firstName: 'John' });
    expect(mockRename).not.toHaveBeenCalled();
  });
});

describe('zdf push contact', () => {
  it('reads local file, puts to Zuora, and calls resolveAndSync with push', async () => {
    mockRead.mockReturnValue({ firstName: 'Jane', lastName: 'Doe' });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'contact', 'CON-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/contacts/CON-001', expect.any(Object));
    expect(mockResolve).toHaveBeenCalledWith('contact', 'CON-001', 'push');
  });
});

describe('zdf delete contact', () => {
  it('calls delete endpoint and resolveAndSync with delete', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'contact', 'CON-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/contacts/CON-001');
    expect(mockResolve).toHaveBeenCalledWith('contact', 'CON-001', 'delete');
  });
});
