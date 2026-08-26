export const ENV_TYPE_TO_BASE_URL: Record<string, string> = {
  'US Production (Cloud 1)': 'https://rest.na.zuora.com',
  'US Production (Cloud 2)': 'https://rest.zuora.com',
  'US API Sandbox (Cloud 1)': 'https://rest.sandbox.na.zuora.com',
  'US API Sandbox (Cloud 2)': 'https://rest.apisandbox.zuora.com',
  'US Developer & Central Sandbox': 'https://rest.test.zuora.com',
  'EU Production': 'https://rest.eu.zuora.com',
  'EU API Sandbox': 'https://rest.sandbox.eu.zuora.com',
  'EU Developer & Central Sandbox': 'https://rest.test.eu.zuora.com',
  'APAC Production': 'https://rest.ap.zuora.com',
  'APAC Developer & Central Sandbox': 'https://rest.test.ap.zuora.com',
};

export const REGION_TO_ENV_TYPES: Record<string, string[]> = {
  US: [
    'US Production (Cloud 1)',
    'US Production (Cloud 2)',
    'US API Sandbox (Cloud 1)',
    'US API Sandbox (Cloud 2)',
    'US Developer & Central Sandbox',
  ],
  EU: [
    'EU Production',
    'EU API Sandbox',
    'EU Developer & Central Sandbox',
  ],
  APAC: [
    'APAC Production',
    'APAC Developer & Central Sandbox',
  ],
};

export const OUTPUT_DIR = 'zdf-output';

export const RESOURCE_SUBFOLDERS: Record<string, string> = {
  account: 'accounts',
  contact: 'contacts',
  subscription: 'subscriptions',
  product: 'products',
  'product-rate-plan': 'product-rate-plans',
  'product-rate-plan-charge': 'product-rate-plan-charges',
  workflow: 'workflows',
  'billing-template': 'billing-templates',
  'data-query': 'data-queries',
  order: 'orders',
  'order-line-item': 'order-line-items',
  invoice: 'invoices',
  'credit-memo': 'credit-memos',
  'debit-memo': 'debit-memos',
  'bill-run': 'bill-runs',
};
