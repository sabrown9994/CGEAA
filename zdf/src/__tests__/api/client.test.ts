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

const mockEnsureToken = vi.hoisted(() => vi.fn(async () => 'tok'));
vi.mock('../../auth/token.js', () => ({ ensureToken: mockEnsureToken }));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/output.js', () => ({ output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: mockWarn } }));

import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiQuery, APIQUERY_MAX_ROWS, setMaxRows, extractZuoraErrors } from '../../api/client.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureToken.mockImplementation(async () => 'tok');
});
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

function axiosErrorWithStatus(status: number, body: unknown = { message: `HTTP ${status}` }) {
  return { response: { status, data: body } };
}

describe('request() reactive 401 refresh-and-retry', () => {
  it('401-then-200: forces exactly one refresh, replays once, returns the 200 result', async () => {
    mockRequest
      .mockRejectedValueOnce(axiosErrorWithStatus(401))
      .mockResolvedValueOnce({ data: { id: '123' } });
    mockEnsureToken.mockImplementationOnce(async () => 'tok').mockImplementationOnce(async () => 'fresh-tok');

    const result = await apiGet('/v1/accounts/123');

    expect(result).toEqual({ id: '123' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    // First call (non-forced, from `request()`'s initial `ensureToken(env)`) + one forced call.
    expect(mockEnsureToken).toHaveBeenCalledTimes(2);
    expect(mockEnsureToken).toHaveBeenNthCalledWith(2, expect.anything(), true);
    // The replay must use the freshly-forced token, not the stale one.
    expect(mockRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fresh-tok' }),
    }));
  });

  it('persistent 401: refreshes once, replays once, then throws — no infinite loop', async () => {
    mockRequest
      .mockRejectedValueOnce(axiosErrorWithStatus(401))
      .mockRejectedValueOnce(axiosErrorWithStatus(401));
    mockEnsureToken.mockImplementationOnce(async () => 'tok').mockImplementationOnce(async () => 'fresh-tok');

    await expect(apiGet('/v1/accounts/123')).rejects.toMatchObject({ statusCode: 401 });

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockEnsureToken).toHaveBeenCalledTimes(2);
    expect(mockEnsureToken).toHaveBeenNthCalledWith(2, expect.anything(), true);
  });

  it('non-401 error (404): no forced refresh, no retry, throws immediately', async () => {
    mockRequest.mockRejectedValueOnce(axiosErrorWithStatus(404, { message: 'Not Found' }));

    await expect(apiGet('/v1/accounts/999')).rejects.toMatchObject({ statusCode: 404 });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    // Only the initial, non-forced ensureToken call from request().
    expect(mockEnsureToken).toHaveBeenCalledTimes(1);
    expect(mockEnsureToken).toHaveBeenCalledWith(expect.anything());
  });

  it('non-401 error (500): no forced refresh, no retry, throws immediately', async () => {
    mockRequest.mockRejectedValueOnce(axiosErrorWithStatus(500, { message: 'Internal Server Error' }));

    await expect(apiGet('/v1/accounts/999')).rejects.toMatchObject({ statusCode: 500 });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockEnsureToken).toHaveBeenCalledTimes(1);
  });

  it('success path: no extra refresh, no retry', async () => {
    mockRequest.mockResolvedValueOnce({ data: { id: 'ok' } });

    const result = await apiGet('/v1/accounts/123');

    expect(result).toEqual({ id: 'ok' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockEnsureToken).toHaveBeenCalledTimes(1);
    expect(mockEnsureToken).toHaveBeenCalledWith(expect.anything());
  });
});

describe('extractZuoraErrors', () => {
  it('extracts v1 lowercase reasons', () => {
    expect(extractZuoraErrors({ reasons: [{ code: 1, message: 'a' }] })).toEqual([
      { code: '1', message: 'a' },
    ]);
  });

  it('extracts v1 lowercase errors', () => {
    expect(extractZuoraErrors({ errors: [{ code: 'x', message: 'b' }] })).toEqual(
      expect.arrayContaining([{ code: 'x', message: 'b' }])
    );
  });

  it('extracts legacy PascalCase Errors', () => {
    expect(extractZuoraErrors({ Success: false, Errors: [{ Code: 'E', Message: 'c' }] })).toEqual([
      { code: 'E', message: 'c' },
    ]);
  });

  it('extracts Settings API messages[] paired with top-level errorCode', () => {
    expect(
      extractZuoraErrors({ errorCode: 'NOT_FOUND', messages: ['no template with key=z'] })
    ).toEqual([{ code: 'NOT_FOUND', message: 'no template with key=z' }]);
  });

  it('extracts SOAP/ZOQL-style FaultCode/FaultMessage', () => {
    expect(extractZuoraErrors({ FaultCode: 'INVALID_TYPE', FaultMessage: 'bad zoql' })).toEqual([
      { code: 'INVALID_TYPE', message: 'bad zoql' },
    ]);
  });

  it('extracts lowercase faultcode/faultstring variant', () => {
    expect(extractZuoraErrors({ faultcode: 'INVALID_TYPE', faultstring: 'bad zoql' })).toEqual([
      { code: 'INVALID_TYPE', message: 'bad zoql' },
    ]);
  });

  it.each([null, {}, 'string'])('returns [] for %p', (body) => {
    expect(extractZuoraErrors(body)).toEqual([]);
  });
});

describe('handleAxiosError message selection via request()', () => {
  it('Settings-API messages body: errors is non-empty and message is the detail, not "HTTP 400"', async () => {
    mockRequest.mockRejectedValueOnce(
      axiosErrorWithStatus(400, {
        errorCode: 'REMOTE_HTTP_CLIENT_ERROR',
        remoteHttpStatus: 404,
        messages: ['No invoice template with key=bogus-id'],
      })
    );

    await expect(apiGet('/settings/invoice-templates/bogus-id')).rejects.toMatchObject({
      statusCode: 400,
      message: 'No invoice template with key=bogus-id',
      errors: [{ code: 'REMOTE_HTTP_CLIENT_ERROR', message: 'No invoice template with key=bogus-id' }],
    });
  });

  it('falls back to "HTTP {status}" only when the body has no message and no extractable errors', async () => {
    mockRequest.mockRejectedValueOnce(axiosErrorWithStatus(500, {}));

    await expect(apiGet('/v1/accounts/999')).rejects.toMatchObject({
      statusCode: 500,
      message: 'HTTP 500',
      errors: [],
    });
  });
});
