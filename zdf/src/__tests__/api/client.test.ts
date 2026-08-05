import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRequest = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: { create: () => ({ request: mockRequest }) },
}));

vi.mock('../../auth/config.js', () => ({
  getActiveEnv: () => ({
    name: 'sandbox',
    type: 'US API Sandbox (Cloud 2)',
    baseUrl: 'https://rest.apisandbox.zuora.com',
    isProduction: false,
    clientId: 'cid',
    clientSecret: 'csec',
    token: 'tok',
    tokenExpiresAt: Date.now() + 60_000,
  }),
}));

vi.mock('../../auth/token.js', () => ({ ensureToken: async () => 'tok' }));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/output.js', () => ({ output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: mockWarn } }));

import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiQuery, APIQUERY_MAX_ROWS, setMaxRows } from '../../api/client.js';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { setMaxRows(APIQUERY_MAX_ROWS); });

describe('apiGet', () => {
  it('calls GET with correct path and auth header', async () => {
    mockRequest.mockResolvedValue({ data: { id: '123' } });
    const result = await apiGet('/v1/accounts/123');
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: '/v1/accounts/123',
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
    }));
    expect(result).toEqual({ id: '123' });
  });
});

describe('apiPost', () => {
  it('calls POST with body', async () => {
    mockRequest.mockResolvedValue({ data: { id: 'new' } });
    await apiPost('/v1/accounts', { name: 'Test' });
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      data: { name: 'Test' },
    }));
  });
});

describe('apiPatch', () => {
  it('calls PATCH with body', async () => {
    mockRequest.mockResolvedValue({ data: { id: 'x' } });
    await apiPatch('/v1/accounts/123', { name: 'Updated' });
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'PATCH',
      data: { name: 'Updated' },
    }));
  });
});

describe('apiDelete', () => {
  it('calls DELETE', async () => {
    mockRequest.mockResolvedValue({ data: { success: true } });
    await apiDelete('/v1/accounts/123');
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('apiQuery', () => {
  it('paginates normally and stops on done:true without warning', async () => {
    mockRequest
      .mockResolvedValueOnce({ data: { records: [{ Id: '1' }], size: 1, done: false, queryLocator: 'loc-1' } })
      .mockResolvedValueOnce({ data: { records: [{ Id: '2' }], size: 1, done: true } });
    const result = await apiQuery('SELECT Id FROM Contact');
    expect(result).toEqual([{ Id: '1' }, { Id: '2' }]);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('stops pagination at APIQUERY_MAX_ROWS and warns instead of following queryMore forever', async () => {
    const pageSize = 1000;
    // Every page returns pageSize records, never signals done, always offers another
    // queryLocator — simulating Zuora ignoring LIMIT and paginating a huge table.
    mockRequest.mockImplementation(async () => ({
      data: {
        records: Array.from({ length: pageSize }, (_, i) => ({ Id: `row-${i}` })),
        size: pageSize,
        done: false,
        queryLocator: 'loc-more',
      },
    }));

    const result = await apiQuery('SELECT Id FROM Invoice LIMIT 3');

    expect(result.length).toBe(APIQUERY_MAX_ROWS);
    // 1 initial query + enough queryMore calls to reach the cap exactly, then stop
    // without issuing a further request.
    expect(mockRequest).toHaveBeenCalledTimes(APIQUERY_MAX_ROWS / pageSize);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toMatch(/cap/i);
  });

  it('setMaxRows overrides the cap so pagination stops at the overridden value, not the default', async () => {
    setMaxRows(10);
    const pageSize = 5;
    mockRequest.mockImplementation(async () => ({
      data: {
        records: Array.from({ length: pageSize }, (_, i) => ({ Id: `row-${i}` })),
        size: pageSize,
        done: false,
        queryLocator: 'loc-more',
      },
    }));

    const result = await apiQuery('SELECT Id FROM Invoice');

    expect(result.length).toBe(10);
    expect(result.length).toBeLessThan(APIQUERY_MAX_ROWS);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toMatch(/10-row cap/);
  });

  it('setMaxRows(Infinity) (the --no-caps behavior) keeps paginating well past the default cap', async () => {
    setMaxRows(Infinity);
    const pageSize = 1000;
    let calls = 0;
    mockRequest.mockImplementation(async () => {
      calls += 1;
      const done = calls >= 7; // 7 pages = 7000 rows, past the 5000-row default cap
      return {
        data: {
          records: Array.from({ length: pageSize }, (_, i) => ({ Id: `row-${i}` })),
          size: pageSize,
          done,
          queryLocator: done ? undefined : 'loc-more',
        },
      };
    });

    const result = await apiQuery('SELECT Id FROM Invoice');

    expect(result.length).toBe(7000);
    expect(result.length).toBeGreaterThan(APIQUERY_MAX_ROWS);
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
