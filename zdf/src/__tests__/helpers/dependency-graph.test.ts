import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockWrite = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiQuery: mockQuery, setDebug: vi.fn() }));
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, deleteResourceFile: mockDeleteFile }));
vi.mock('../../helpers/output.js', () => ({ output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

import { resolveAndSync } from '../../helpers/dependency-graph.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('resolveAndSync visited-set loop prevention', () => {
  it('skips a resource+id pair already in the visited set', async () => {
    const visited = new Set(['account:ACC-001']);
    await resolveAndSync('account', 'ACC-001', 'pull', visited);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('resolveAndSync contact pull — no dependencies', () => {
  it('adds contact to visited set and fetches nothing else', async () => {
    mockGet.mockResolvedValue({ id: 'CON-001', accountId: 'ACC-001', success: true });
    const visited = new Set<string>();
    await resolveAndSync('contact', 'CON-001', 'pull', visited);
    expect(mockGet).toHaveBeenCalledWith('/v1/contacts/CON-001');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(visited.has('contact:CON-001')).toBe(true);
  });
});

describe('resolveAndSync contact push — re-fetches parent account', () => {
  it('fetches contact then re-fetches parent account', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'CON-001', accountId: 'ACC-001', success: true }) // contact
      .mockResolvedValueOnce({ id: 'ACC-001', name: 'Acme', success: true });          // account
    mockQuery.mockResolvedValue([]);
    await resolveAndSync('contact', 'CON-001', 'push', new Set());
    expect(mockGet).toHaveBeenNthCalledWith(1, '/v1/contacts/CON-001');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/accounts/ACC-001');
  });
});

describe('resolveAndSync subscription pull — embeds ratePlans inline', () => {
  it('writes subscription with ratePlans from Zuora response', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'SUB-001',
      accountId: 'ACC-001',
      ratePlans: [{ id: 'rp-1', ratePlanCharges: [{ id: 'rpc-1', name: 'Monthly Fee' }] }],
      success: true,
    });
    await resolveAndSync('subscription', 'SUB-001', 'pull', new Set(['account:ACC-001']));
    expect(mockWrite).toHaveBeenCalledWith('subscription', 'SUB-001', expect.objectContaining({
      ratePlans: [expect.objectContaining({ id: 'rp-1' })],
    }));
  });
});
