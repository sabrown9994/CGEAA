import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn() }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
}));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, deleteResourceFile: vi.fn(), resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT'), }));
vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import { register } from '../../commands/bill-runs.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull bill-run', () => {
  it('calls resolveAndSync with pull', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'bill-run', 'BR-001']);
    expect(mockResolve).toHaveBeenCalledWith('bill-run', 'BR-001', 'pull');
  });
});

describe('zdf push bill-run', () => {
  it('re-fetches by calling resolveAndSync with pull (no PUT endpoint)', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'bill-run', 'BR-001']);
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('bill-run', 'BR-001', 'pull');
  });
});

describe('zdf delete bill-run', () => {
  it('calls delete and resolveAndSync with delete', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'bill-run', 'BR-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/bill-runs/BR-001');
    expect(mockResolve).toHaveBeenCalledWith('bill-run', 'BR-001', 'delete');
  });
});
