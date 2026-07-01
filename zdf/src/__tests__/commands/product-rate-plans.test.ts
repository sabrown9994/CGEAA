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

import { register } from '../../commands/product-rate-plans.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull product-rate-plan', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'product-rate-plan', 'prp-001']);
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan', 'prp-001', 'pull');
  });
});

describe('zdf create product-rate-plan', () => {
  it('reads local file, posts to rateplan endpoint, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ Name: 'Test Rate Plan', ProductId: 'prod-001' });
    mockPost.mockResolvedValue({ success: true, id: 'new-prp-id' });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product-rate-plan', 'my-plan']);
    expect(mockPost).toHaveBeenCalledWith('/v1/rateplan', expect.any(Object));
    expect(mockRename).toHaveBeenCalledWith('product-rate-plan', 'my-plan', 'new-prp-id');
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
    expect(mockDelete).toHaveBeenCalledWith('/v1/rateplan/prp-001');
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan', 'prp-001', 'delete');
  });
});
