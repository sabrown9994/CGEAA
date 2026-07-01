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
