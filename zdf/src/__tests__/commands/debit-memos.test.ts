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
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, deleteResourceFile: vi.fn() }));
vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import { register } from '../../commands/debit-memos.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull debit-memo', () => {
  it('calls resolveAndSync with pull', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'debit-memo', 'DM-001']);
    expect(mockResolve).toHaveBeenCalledWith('debit-memo', 'DM-001', 'pull');
  });
});

describe('zdf push debit-memo', () => {
  it('reads file, puts to Zuora', async () => {
    mockRead.mockReturnValue({ id: 'DM-001', debitMemoItems: [{ id: 'item-1', amount: 75 }] });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'debit-memo', 'DM-001']);
    expect(mockPut).toHaveBeenCalledWith('/v1/debit-memos/DM-001', expect.any(Object));
  });
});

describe('zdf delete debit-memo', () => {
  it('calls delete and resolveAndSync with delete', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'debit-memo', 'DM-001']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/debit-memos/DM-001');
    expect(mockResolve).toHaveBeenCalledWith('debit-memo', 'DM-001', 'delete');
  });
});
