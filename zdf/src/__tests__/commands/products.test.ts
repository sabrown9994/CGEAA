import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: vi.fn(), apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: vi.fn(), setDebug: vi.fn() }));

const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: vi.fn(), readResourceFile: mockRead, renameResourceFile: mockRename, deleteResourceFile: vi.fn() }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
}));

import { register } from '../../commands/products.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull product', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'product', 'prod-001']);
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'pull');
  });
});

describe('zdf create product', () => {
  it('reads local file, posts to catalog endpoint, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001' });
    mockPost.mockResolvedValue({ success: true, id: 'new-prod-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product', 'my-product']);
    expect(mockPost).toHaveBeenCalledWith('/v1/catalog/products', expect.any(Object));
    expect(mockRename).toHaveBeenCalledWith('product', 'my-product', 'new-prod-id');
  });
});

describe('zdf push product', () => {
  it('reads file, filters to updatable fields, puts to object endpoint, calls resolveAndSync', async () => {
    mockRead.mockReturnValue({ Name: 'Test Product', SKU: 'SKU-001', CreatedById: 'readonly', AllowFeatureChanges: true });
    mockPut.mockResolvedValue({ Success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/object/product/prod-001', expect.objectContaining({ Name: 'Test Product', SKU: 'SKU-001', AllowFeatureChanges: true }));
    // CreatedById is not in allowlist — should be filtered out
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('CreatedById');
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'push');
  });

  it('exits with error when Zuora returns Success false', async () => {
    mockRead.mockReturnValue({ Name: 'Test Product' });
    mockPut.mockResolvedValue({ Success: false, Errors: [{ Code: 'MISSING_REQUIRED_VALUE', Message: 'Missing Item__c' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'product', 'prod-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf delete product', () => {
  it('calls delete endpoint and resolveAndSync with delete action', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'product', 'prod-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/catalog/products/prod-001');
    expect(mockResolve).toHaveBeenCalledWith('product', 'prod-001', 'delete');
  });
});
