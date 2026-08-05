import axios, { AxiosError } from 'axios';
import type { AxiosInstance } from 'axios';
import { getActiveEnv } from '../auth/config.js';
import { ensureToken } from '../auth/token.js';
import type { ZuoraErrorResponse } from '../types.js';
import { output } from '../helpers/output.js';

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

// Zuora's /v1/action/query does NOT honor a ZOQL LIMIT clause — a broad query can
// paginate through an entire table (observed: `LIMIT 3` returned 8610 rows). This cap
// bounds how many rows apiQuery will collect via queryMore before giving up and
// returning what it has, so a single query can't hang or explode a pull. The value is
// intentionally high relative to normal per-account/per-product child collections
// (contacts, invoices, rate plans, etc.) so real-world queries are never affected.
export const APIQUERY_MAX_ROWS = 5000;

// Current effective cap. Defaults to the constant above; overridable per-invocation via
// `--max-rows <n>` (or set to Infinity by `--no-caps`/`--unbounded`). See bin/zdf.ts and
// src/helpers/command-runner.ts for how the CLI flags reach this setter.
let apiQueryMaxRows: number = APIQUERY_MAX_ROWS;

export function setMaxRows(n: number): void {
  apiQueryMaxRows = n;
}

type QueryResponse<T> = { records: T[]; size: number; done: boolean; queryLocator?: string };

export async function apiQuery<T>(zoql: string): Promise<T[]> {
  const all: T[] = [];
  let res = await request<QueryResponse<T>>('POST', '/v1/action/query', { queryString: zoql });
  if (res.records) all.push(...res.records);
  while (!res.done && res.queryLocator) {
    if (all.length >= apiQueryMaxRows) {
      output.warn(
        `apiQuery: hit the ${apiQueryMaxRows}-row cap before pagination finished; returning ${all.length} rows collected so far. Query: ${zoql}`
      );
      break;
    }
    res = await request<QueryResponse<T>>('POST', '/v1/action/queryMore', { queryLocator: res.queryLocator });
    if (res.records) all.push(...res.records);
  }
  return all;
}
