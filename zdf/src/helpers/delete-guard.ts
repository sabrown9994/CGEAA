// Intentionally empty — no resources are currently blocked from delete. Retained (along with
// checkDeleteAllowed) as the eligibility hook the planned sync-diff feature will call, and for
// future Zuora-API-level delete restrictions.
const BLOCKED: Record<string, string> = {};

export function checkDeleteAllowed(resource: string): void {
  const msg = BLOCKED[resource];
  if (msg) throw new Error(msg);
}

// Intentionally empty — no creates are currently blocked by tenant configuration. Retained
// (along with checkTenantSupported) as the eligibility hook the planned sync-diff feature will
// call, and for future tenant-config blocks.
const TENANT_BLOCKED: Record<string, Record<string, string>> = {
  create: {},
};

export function checkTenantSupported(resource: string, verb: string): void {
  const msg = TENANT_BLOCKED[verb]?.[resource];
  if (msg) throw new Error(msg);
}
