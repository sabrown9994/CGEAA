import axios from 'axios';
import { saveUpdatedEnv } from './config.js';
import type { EnvironmentConfig } from '../types.js';

// In-memory token cache for env-var (CI) mode. In that mode there is no config
// file, so a refreshed token cannot be persisted via saveUpdatedEnv (which would
// throw "No ZDF configuration found"). getActiveEnv() also returns a fresh,
// token-less env object on every call, so without this cache every API request in
// a single process would re-fetch an OAuth token. Keyed by clientId so distinct
// credentials don't collide within one process.
const memoryTokens = new Map<string, { token: string; expiresAt: number }>();

/** Clears the in-memory env-var token cache. Exposed for tests. */
export function clearTokenCache(): void {
  memoryTokens.clear();
}

export async function ensureToken(env: EnvironmentConfig, force = false): Promise<string> {
  // Persisted (file-based) cache.
  if (!force && env.token && env.tokenExpiresAt && env.tokenExpiresAt > Date.now()) {
    return env.token;
  }
  // In-memory cache (env-var mode).
  if (!force && env.fromEnv) {
    const cached = memoryTokens.get(env.clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });

  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    `${env.baseUrl}/oauth/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const expiresAt = Date.now() + data.expires_in * 1000;
  if (env.fromEnv) {
    // No config file to write to in env-var mode — cache in memory for this process.
    memoryTokens.set(env.clientId, { token: data.access_token, expiresAt });
  } else {
    saveUpdatedEnv({ ...env, token: data.access_token, tokenExpiresAt: expiresAt });
  }
  return data.access_token;
}
