export type ResourceClass = 'config' | 'catalog' | 'financial' | 'utility';
export type VerbClass = 'read' | 'write';

export const RESOURCE_CLASS: Record<string, ResourceClass> = {
  // config
  workflow: 'config',
  'billing-template': 'config',
  // catalog
  product: 'catalog',
  'product-rate-plan': 'catalog',
  'product-rate-plan-charge': 'catalog',
  // financial
  account: 'financial',
  contact: 'financial',
  subscription: 'financial',
  order: 'financial',
  'order-line-item': 'financial',
  invoice: 'financial',
  'credit-memo': 'financial',
  'debit-memo': 'financial',
  'bill-run': 'financial',
  // utility
  'data-query': 'utility',
};

const READ_VERBS = new Set(['pull', 'list', 'auth']);

export function classifyVerb(verb: string): VerbClass {
  return READ_VERBS.has(verb) ? 'read' : 'write';
}

export type PolicyDecision =
  | { action: 'allow' }
  | { action: 'confirm' }
  | { action: 'block'; reason: string };

export function decideProductionPolicy(input: {
  isProduction: boolean;
  verb: string;
  resource: string;
  allowProdFinancial: boolean;
}): PolicyDecision {
  const { isProduction, verb, resource, allowProdFinancial } = input;

  if (!isProduction) return { action: 'allow' };

  const verbClass = classifyVerb(verb);
  if (verbClass === 'read') return { action: 'allow' };

  const resourceClass = RESOURCE_CLASS[resource];

  if (resourceClass === undefined || resourceClass === 'financial') {
    if (allowProdFinancial) return { action: 'confirm' };
    return {
      action: 'block',
      reason:
        `Refusing to ${verb} "${resource}" against a PRODUCTION environment: this is a financial ` +
        `(or unrecognized) resource. Pass --allow-prod-financial or set ZDF_ALLOW_PROD_FINANCIAL=true ` +
        `to override.`,
    };
  }

  // config | catalog | utility
  return { action: 'confirm' };
}

let invoked: { verb: string; resource: string } | null = null;

export function setInvokedCommand(verb: string, resource: string): void {
  invoked = { verb, resource };
}

export function getInvokedCommand(): { verb: string; resource: string } | null {
  return invoked;
}

export function resetInvokedCommand(): void {
  invoked = null;
}
