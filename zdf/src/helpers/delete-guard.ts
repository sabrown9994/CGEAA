const BLOCKED: Record<string, string> = {
  subscription:
    'delete subscription is not supported in Zuora. The Zuora API does not expose a DELETE ' +
    'endpoint for subscriptions. To cancel a subscription, use the Zuora UI or the Orders API. ' +
    "See zdf/TODO.md under 'Tenant-config limitations' for details.",
};

export function checkDeleteAllowed(resource: string): void {
  const msg = BLOCKED[resource];
  if (msg) throw new Error(msg);
}

const TENANT_BLOCKED: Record<string, Record<string, string>> = {
  create: {
    // NOTE: `create product` is now SUPPORTED via the Commerce API (POST /commerce/products) —
    // it is intentionally NOT listed here anymore. See src/commands/products.ts.
    subscription:
      'create subscription is not currently supported on this Zuora environment. The legacy ' +
      'Subscriptions API is disabled because Orders is enabled on this tenant. Use the Orders ' +
      "API to manage subscription lifecycle. See zdf/TODO.md under 'Tenant-config limitations' " +
      'for details.',
    invoice:
      'create invoice is not currently supported on this Zuora environment. Standalone invoice ' +
      'creation requires Finance > Manage Non-Subscription Items settings (revenue recognition ' +
      "accounting codes) which are not configured. See zdf/TODO.md under 'Tenant-config " +
      "limitations' for details.",
  },
};

export function checkTenantSupported(resource: string, verb: string): void {
  const msg = TENANT_BLOCKED[verb]?.[resource];
  if (msg) throw new Error(msg);
}
