import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockPut = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: mockPut, apiDelete: vi.fn(), apiQuery: vi.fn(), setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockRead = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: vi.fn(), readResourceFile: mockRead, deleteResourceFile: vi.fn(), resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT'), }));

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

import { register } from '../../commands/product-rate-plan-charges.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull product-rate-plan-charge', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'product-rate-plan-charge', 'prpc-001']);
    expect(mockResolve).toHaveBeenCalledWith('product-rate-plan-charge', 'prpc-001', 'pull');
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
