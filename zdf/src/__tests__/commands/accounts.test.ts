import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn() }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
}));

import { register } from '../../commands/accounts.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull account', () => {
  it('calls resolveAndSync with pull action', async () => {
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'account', 'acc-1']);
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'pull');
  });
});

describe('zdf create account', () => {
  it('reads local file, posts to Zuora, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ name: 'New Acct' });
    mockPost.mockResolvedValue({ accountId: 'new-zuora-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'account', 'my-draft']);
    expect(mockPost).toHaveBeenCalledWith('/v1/accounts', { name: 'New Acct' });
    expect(mockRename).toHaveBeenCalledWith('account', 'my-draft', 'new-zuora-id');
  });
});

describe('zdf delete account', () => {
  it('calls delete endpoint and resolveAndSync with delete action', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'account', 'acc-1']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/accounts/acc-1');
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'delete');
  });
});

describe('zdf push account', () => {
  it('extracts basicInfo, filters to updatable fields, puts to Zuora, and calls resolveAndSync', async () => {
    mockRead.mockReturnValue({
      basicInfo: {
        id: 'acc-1',            // read-only — should be filtered out
        name: 'Updated Acct',  // updatable — should remain
        batch: 'Batch1',       // updatable — should remain
        accountNumber: 'ACG123', // read-only — should be filtered out
      },
      billingAndPayment: { currency: 'USD' },
    });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    expect(mockPut).toHaveBeenCalledWith('/v1/accounts/acc-1', {
      name: 'Updated Acct',
      batch: 'Batch1',
    });
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'push');
  });

  it('exits with error when Zuora returns success false', async () => {
    mockRead.mockReturnValue({
      basicInfo: { id: 'acc-1', name: 'Test' },
    });
    mockPut.mockResolvedValue({
      success: false,
      reasons: [{ code: 58230015, message: 'Invalid field value.' }],
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('exits with error when basicInfo is missing', async () => {
    mockRead.mockReturnValue({ name: 'No basic info here' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});
