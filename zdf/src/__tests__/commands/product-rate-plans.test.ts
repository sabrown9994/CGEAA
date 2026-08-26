import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: vi.fn(), apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: vi.fn(), setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: vi.fn(), readResourceFile: mockRead, renameResourceFile: mockRename, deleteResourceFile: vi.fn(), resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT'), }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  getLastPulledPath: vi.fn(() => null),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

import { register } from '../../commands/product-rate-plans.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull product-rate-plan', () => {
  it('calls resolveAndSync with pull action and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'product-rate-plan', 'prp-001']);
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan', 'prp-001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'product-rate-plan', 'prp-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create product-rate-plan', () => {
  it('reads local file, posts to object endpoint, renames file to PascalCase Zuora Id', async () => {
    mockRead.mockReturnValue({ Name: 'Test Rate Plan', ProductId: 'prod-001' });
    // Object endpoint returns PascalCase {Id, Success}
    mockPost.mockResolvedValue({ Id: 'new-prp-id', Success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product-rate-plan', 'my-plan']);
    expect(mockPost).toHaveBeenCalledWith('/v1/object/product-rate-plan', expect.any(Object));
    expect(mockRename).toHaveBeenCalledWith('product-rate-plan', 'my-plan', 'new-prp-id');
  });

  it('exits with error when Zuora returns Success false', async () => {
    mockRead.mockReturnValue({ Name: 'Test Rate Plan' });
    mockPost.mockResolvedValue({ Id: '', Success: false, Errors: [{ Code: 'ERR', Message: 'bad' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'product-rate-plan', 'my-plan'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf push product-rate-plan', () => {
  it('reads file, filters to updatable fields, puts to object endpoint, calls resolveAndSync', async () => {
    mockRead.mockReturnValue({ Name: 'Test Plan', Description: 'test', ProductId: 'prod-001', CreatedById: 'readonly', EffectiveStartDate: '2020-01-01' });
    mockPut.mockResolvedValue({ Success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product-rate-plan', 'prp-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/object/product-rate-plan/prp-001', expect.objectContaining({ Name: 'Test Plan', EffectiveStartDate: '2020-01-01' }));
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('CreatedById');
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan', 'prp-001', 'push');
  });

  it('exits with error when Zuora returns Success false', async () => {
    mockRead.mockReturnValue({ Name: 'Test Plan' });
    mockPut.mockResolvedValue({ Success: false, Errors: [{ Code: 'INVALID_VALUE', Message: 'test error' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'product-rate-plan', 'prp-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf delete product-rate-plan', () => {
  it('calls delete endpoint and resolveAndSync with delete action', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'product-rate-plan', 'prp-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/object/product-rate-plan/prp-001');
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan', 'prp-001', 'delete');
  });
});
