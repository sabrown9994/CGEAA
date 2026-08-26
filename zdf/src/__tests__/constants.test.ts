import { describe, it, expect } from 'vitest';
import { ENV_TYPE_TO_BASE_URL, REGION_TO_ENV_TYPES, RESOURCE_SUBFOLDERS } from '../constants.js';

describe('ENV_TYPE_TO_BASE_URL', () => {
  it('maps US Production Cloud 2 to correct URL', () => {
    expect(ENV_TYPE_TO_BASE_URL['US Production (Cloud 2)']).toBe('https://rest.zuora.com');
  });
  it('has 10 entries', () => {
    expect(Object.keys(ENV_TYPE_TO_BASE_URL)).toHaveLength(10);
  });
});

describe('REGION_TO_ENV_TYPES', () => {
  it('US region has 5 types', () => {
    expect(REGION_TO_ENV_TYPES['US']).toHaveLength(5);
  });
  it('every type in each region exists in ENV_TYPE_TO_BASE_URL', () => {
    for (const types of Object.values(REGION_TO_ENV_TYPES)) {
      for (const t of types) {
        expect(ENV_TYPE_TO_BASE_URL[t]).toBeDefined();
      }
    }
  });
});

describe('RESOURCE_SUBFOLDERS', () => {
  it('maps account to accounts', () => {
    expect(RESOURCE_SUBFOLDERS['account']).toBe('accounts');
  });
  it('maps billing-template to billing-templates', () => {
    expect(RESOURCE_SUBFOLDERS['billing-template']).toBe('billing-templates');
  });
});
