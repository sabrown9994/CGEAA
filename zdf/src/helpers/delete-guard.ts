const BLOCKED: Record<string, string> = {
  subscription:
    'Subscriptions cannot be deleted in Zuora. To cancel a subscription, use the Zuora UI or Orders API.',
};

export function checkDeleteAllowed(resource: string): void {
  const msg = BLOCKED[resource];
  if (msg) throw new Error(msg);
}
