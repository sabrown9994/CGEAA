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

  const attempt = async (bearerToken: string): Promise<T> => {
    log(`→ ${method} ${env.baseUrl}${path}`);
    if (data !== undefined) log('  request body:', JSON.stringify(data, null, 2));

    const response = await client.request<T>({
      method,
      url: path,
      data,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
    });
    log(`← ${response.status} ${method} ${path}`);
    log('  response body:', JSON.stringify(response.data, null, 2));
    return response.data;
  };

  try {
    return await attempt(token);
  } catch (err) {
    const axiosErr = err as AxiosError<{ errors?: Array<{ code: string; message: string }>; reasons?: Array<{ code: number; message: string }>; message?: string }>;
    if (axiosErr.response?.status === 401) {
      log(`← 401 ${method} ${path} (token rejected, forcing refresh and retrying once)`);
      const freshToken = await ensureToken(env, true);
      try {
        return await attempt(freshToken);
      } catch (retryErr) {
        return handleAxiosError(retryErr, method, path);
      }
    }
    return handleAxiosError(err, method, path);
  }
}

// Zuora returns error detail in several different body shapes depending on which API
// generation handled the request. This helper flattens all known shapes into a single
// list so handleAxiosError never has to fall back to a bare "HTTP {status}" when detail
// is actually present in the body. De-dup across shapes is intentionally not performed —
// a body should only ever match one shape in practice.
export function extractZuoraErrors(body: unknown): Array<{ code: string; message: string }> {
  if (typeof body !== 'object' || body === null) return [];
  const b = body as Record<string, unknown>;
  const out: Array<{ code: string; message: string }> = [];

  // v1 lowercase: { reasons: [{ code, message }] }
  if (Array.isArray(b.reasons)) {
    for (const r of b.reasons) {
      if (r && typeof r === 'object') {
        const rr = r as Record<string, unknown>;
        out.push({ code: String(rr.code ?? ''), message: String(rr.message ?? '') });
      }
    }
  }

  // v1 lowercase: { errors: [{ code, message }] }
  if (Array.isArray(b.errors)) {
    for (const e of b.errors) {
      if (e && typeof e === 'object') {
        const ee = e as Record<string, unknown>;
        out.push({ code: String(ee.code ?? ''), message: String(ee.message ?? '') });
      }
    }
  }

  // Legacy object endpoints (PascalCase): { Success: false, Errors: [{ Code, Message }] }
  if (Array.isArray(b.Errors)) {
    for (const e of b.Errors) {
      if (e && typeof e === 'object') {
        const ee = e as Record<string, unknown>;
        out.push({ code: String(ee.Code ?? ''), message: String(ee.Message ?? '') });
      }
    }
  }

  // Settings API: { errorCode, remoteHttpStatus?, messages: ["...", ...] }
  if (Array.isArray(b.messages)) {
    for (const m of b.messages) {
      out.push({ code: String((b.errorCode as unknown) ?? ''), message: String(m) });
    }
  }

  // SOAP/ZOQL-style: { FaultCode, FaultMessage } or { faultcode, faultstring }
  const faultMessage = b.FaultMessage ?? b.faultstring;
  if (typeof faultMessage === 'string' && faultMessage.length > 0) {
    const faultCode = b.FaultCode ?? b.faultcode;
    out.push({ code: String(faultCode ?? ''), message: faultMessage });
  }

  return out;
}

function handleAxiosError(err: unknown, method: string, path: string): never {
  const axiosErr = err as AxiosError<{ message?: string }>;
  if (axiosErr.response) {
    const { status, data: body } = axiosErr.response;
    log(`← ${status} ${method} ${path} (error)`);
    log('  error body:', JSON.stringify(body, null, 2));
    const errors = extractZuoraErrors(body);
    const bodyMessage = body?.message;
    const message =
      typeof bodyMessage === 'string' && bodyMessage.length > 0
        ? bodyMessage
        : errors.length > 0
          ? errors[0].message
          : `HTTP ${status}`;
    const zuoraErr: ZuoraErrorResponse = {
      statusCode: status,
      message,
      errors,
    };
    throw zuoraErr;
  }
  throw err;
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
