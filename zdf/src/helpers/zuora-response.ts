export type ZuoraWriteResponse = {
  success: boolean;
  reasons?: Array<{ code: number | string; message: string }>;
  errors?: Array<{ code: number | string; message: string }>;
  processId?: string;
};

export function assertSuccess(res: ZuoraWriteResponse, label: string): void {
  if (!res.success) {
    const reasons = res.reasons ?? res.errors ?? [];
    const detail = reasons.map(r => `  ${r.code}: ${r.message}`).join('\n');
    throw new Error(`Zuora rejected the ${label}.${detail ? '\n' + detail : ''}`);
  }
}

export type ZuoraReadResponse = {
  success?: boolean;
  reasons?: Array<{ code: number | string; message: string }>;
  errors?: Array<{ code: number | string; message: string }>;
};

/**
 * Guard for READ (GET) responses. Zuora returns HTTP 200 with
 * `{ success: false, reasons: [...] }` for bad requests, so a 2xx HTTP
 * status alone does not mean the body is usable.
 *
 * A valid response may have no `success` field at all (e.g. a workflow
 * object) — that is NOT a failure. Only an explicit `success === false`,
 * or a populated `reasons`/`errors` array, counts as a failure.
 */
export function assertReadSuccess(res: ZuoraReadResponse, label: string): void {
  const reasons = res.reasons ?? res.errors ?? [];
  const failed = res.success === false || reasons.length > 0;
  if (failed) {
    const detail = reasons.map(r => `  ${r.code}: ${r.message}`).join('\n');
    throw new Error(`Zuora rejected the ${label}.${detail ? '\n' + detail : ''}`);
  }
}
