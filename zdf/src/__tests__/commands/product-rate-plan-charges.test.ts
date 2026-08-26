import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockPut = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
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

import { register } from '../../commands/product-rate-plan-charges.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull product-rate-plan-charge', () => {
  it('calls resolveAndSync with pull action and succeeds when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'product-rate-plan-charge', 'prpc-001']);
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan-charge', 'prpc-001', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'product-rate-plan-charge', 'prpc-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf push product-rate-plan-charge', () => {
  it('reads file, filters to updatable fields, puts to object endpoint, calls resolveAndSync', async () => {
    mockRead.mockReturnValue({ Name: 'Monthly Charge', Description: 'test', ChargeType: 'Recurring', BillingPeriod: 'Month' });
    mockPut.mockResolvedValue({ Success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'product-rate-plan-charge', 'prpc-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/object/product-rate-plan-charge/prpc-001', expect.objectContaining({ Name: 'Monthly Charge', BillingPeriod: 'Month' }));
    // ChargeType is read-only — should be filtered out
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('ChargeType');
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan-charge', 'prpc-001', 'push');
  });

  it('exits with error when Zuora returns Success false', async () => {
    mockRead.mockReturnValue({ Name: 'Test' });
    mockPut.mockResolvedValue({ Success: false, Errors: [{ Code: 'INVALID_VALUE', Message: 'test error' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'product-rate-plan-charge', 'prpc-001'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create product-rate-plan-charge', () => {
  it('posts the file body to the create endpoint and renames the local file to the returned Id', async () => {
    mockRead.mockReturnValue({ Name: 'Monthly Charge', ProductRatePlanId: 'prp-001', ChargeType: 'Recurring' });
    mockPost.mockResolvedValue({ Id: 'prpc-999', Success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'product-rate-plan-charge', 'new-charge']);
    expect(mockPost).toHaveBeenCalledWith('/v1/object/product-rate-plan-charge', { Name: 'Monthly Charge', ProductRatePlanId: 'prp-001', ChargeType: 'Recurring' });
    expect(mockRename).toHaveBeenCalledWith('product-rate-plan-charge', 'new-charge', 'prpc-999');
  });

  it('exits with error and does not rename when Zuora returns Success false', async () => {
    mockRead.mockReturnValue({ Name: 'Bad Charge' });
    mockPost.mockResolvedValue({ Success: false, Errors: [{ Code: 'INVALID_VALUE', Message: 'ProductRatePlanId is required' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'product-rate-plan-charge', 'new-charge'])
    ).rejects.toThrow('exit');
    expect(mockRename).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf delete product-rate-plan-charge', () => {
  it('deletes the object endpoint and calls resolveAndSync with delete action', async () => {
    // DELETE /v1/object/product-rate-plan-charge returns lowercase {success,id} — same as PRP delete
    mockDelete.mockResolvedValue({ success: true, id: 'prpc-001' });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'product-rate-plan-charge', 'prpc-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/object/product-rate-plan-charge/prpc-001');
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan-charge', 'prpc-001', 'delete');
  });

  it('exits with error when Zuora returns success false', async () => {
    mockDelete.mockResolvedValue({ success: false, reasons: [{ code: 'CANNOT_DELETE', message: 'not found' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'product-rate-plan-charge', 'prpc-001'])
    ).rejects.toThrow('exit');
    expect(mockResolve).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
