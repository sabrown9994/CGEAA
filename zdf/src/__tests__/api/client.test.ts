import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '../../api/client.js';

beforeEach(() => { vi.clearAllMocks(); });

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
