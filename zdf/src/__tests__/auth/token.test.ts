import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvironmentConfig } from '../../types.js';

const { mockPost, mockSave } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockSave: vi.fn(),
}));

vi.mock('axios', () => ({ default: { post: mockPost } }));
vi.mock('../../auth/config.js', () => ({ saveUpdatedEnv: mockSave }));

import { ensureToken } from '../../auth/token.js';

const baseEnv: EnvironmentConfig = {
  name: 'sandbox',
  type: 'US API Sandbox (Cloud 2)',
  baseUrl: 'https://rest.apisandbox.zuora.com',
  isProduction: false,
  clientId: 'cid',
  clientSecret: 'csec',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('ensureToken', () => {
  it('returns cached token when not expired', async () => {
    const env = { ...baseEnv, token: 'cached', tokenExpiresAt: Date.now() + 60_000 };
    const token = await ensureToken(env);
    expect(token).toBe('cached');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('fetches a new token when expired', async () => {
    const before = Date.now();
    const env = { ...baseEnv, token: 'old', tokenExpiresAt: Date.now() - 1 };
    mockPost.mockResolvedValue({ data: { access_token: 'new-tok', expires_in: 3600 } });
    const token = await ensureToken(env);
    const after = Date.now();
    expect(token).toBe('new-tok');
    const savedCall = mockSave.mock.calls[0][0] as { token: string; tokenExpiresAt: number };
    expect(savedCall.token).toBe('new-tok');
    expect(savedCall.tokenExpiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(savedCall.tokenExpiresAt).toBeLessThanOrEqual(after + 3_600_000);
  });

  it('fetches a new token when none cached', async () => {
    mockPost.mockResolvedValue({ data: { access_token: 'fresh', expires_in: 3600 } });
    const token = await ensureToken(baseEnv);
    expect(token).toBe('fresh');
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('force=true bypasses the not-expired short-circuit and fetches a new token', async () => {
    const env = { ...baseEnv, token: 'still-valid', tokenExpiresAt: Date.now() + 60_000 };
    mockPost.mockResolvedValue({ data: { access_token: 'forced-fresh', expires_in: 3600 } });

    const token = await ensureToken(env, true);

    expect(token).toBe('forced-fresh');
    expect(mockPost).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledOnce();
  });
});
