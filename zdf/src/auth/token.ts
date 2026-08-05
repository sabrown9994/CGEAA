import axios from 'axios';
import { saveUpdatedEnv } from './config.js';
import type { EnvironmentConfig } from '../types.js';

export async function ensureToken(env: EnvironmentConfig, force = false): Promise<string> {
  if (!force && env.token && env.tokenExpiresAt && env.tokenExpiresAt > Date.now()) {
    return env.token;
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

  const updated: EnvironmentConfig = {
    ...env,
    token: data.access_token,
    tokenExpiresAt: Date.now() + data.expires_in * 1000,
  };
  saveUpdatedEnv(updated);
  return data.access_token;
}
