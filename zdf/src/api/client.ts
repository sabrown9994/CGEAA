import axios, { AxiosError } from 'axios';
import type { AxiosInstance } from 'axios';
import { getActiveEnv } from '../auth/config.js';
import { ensureToken } from '../auth/token.js';
import type { ZuoraErrorResponse } from '../types.js';

let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

function log(...args: unknown[]): void {
  if (debugEnabled) console.error('[zdf:debug]', ...args);
}

function createAxiosInstance(baseUrl: string): AxiosInstance {
  return axios.create({ baseURL: baseUrl });
}

async function request<T>(method: string, path: string, data?: unknown): Promise<T> {
  const env = getActiveEnv();
  const token = await ensureToken(env);
  const client = createAxiosInstance(env.baseUrl);

  log(`→ ${method} ${env.baseUrl}${path}`);
  if (data !== undefined) log('  request body:', JSON.stringify(data, null, 2));

  try {
    const response = await client.request<T>({
      method,
      url: path,
      data,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    log(`← ${response.status} ${method} ${path}`);
    log('  response body:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (err) {
    const axiosErr = err as AxiosError<{ errors?: Array<{ code: string; message: string }>; reasons?: Array<{ code: number; message: string }>; message?: string }>;
    if (axiosErr.response) {
      const { status, data: body } = axiosErr.response;
      log(`← ${status} ${method} ${path} (error)`);
      log('  error body:', JSON.stringify(body, null, 2));
      const zuoraErr: ZuoraErrorResponse = {
        statusCode: status,
        message: body?.message ?? `HTTP ${status}`,
        errors: body?.errors ?? body?.reasons?.map(r => ({ code: String(r.code), message: r.message })) ?? [],
      };
      throw zuoraErr;
    }
    throw err;
  }
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body: unknown) => request<T>('POST', path, body);
export const apiPut = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
export const apiPatch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);

export async function apiQuery<T>(zoql: string): Promise<T[]> {
  const all: T[] = [];
  let res = await request<{ records: T[]; size: number; done: boolean; queryLocator?: string }>(
    'POST',
    '/v1/action/query',
    { queryString: zoql }
  );
  if (res.records) all.push(...res.records);
  while (!res.done && res.queryLocator) {
    res = await request<{ records: T[]; size: number; done: boolean; queryLocator?: string }>(
      'POST',
      '/v1/action/queryMore',
      { queryLocator: res.queryLocator }
    );
    if (res.records) all.push(...res.records);
  }
  return all;
}
