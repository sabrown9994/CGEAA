import { describe, it, expect } from 'vitest';
import { checkDeleteAllowed, checkTenantSupported } from '../../helpers/delete-guard.js';

describe('checkDeleteAllowed', () => {
  it('does not throw for subscription (no resources are currently blocked)', () => {
    expect(() => checkDeleteAllowed('subscription')).not.toThrow();
  });

  it('does not throw for account', () => {
    expect(() => checkDeleteAllowed('account')).not.toThrow();
  });

  it('does not throw for product', () => {
    expect(() => checkDeleteAllowed('product')).not.toThrow();
  });
});

describe('checkTenantSupported', () => {
  it('does not throw for create product (now supported via Commerce API)', () => {
    expect(() => checkTenantSupported('product', 'create')).not.toThrow();
  });

  it('does not throw for create subscription (no resources are currently blocked)', () => {
    expect(() => checkTenantSupported('subscription', 'create')).not.toThrow();
  });

  it('does not throw for create invoice (now supported — accounting fields required in body)', () => {
    expect(() => checkTenantSupported('invoice', 'create')).not.toThrow();
  });

  it('does not throw for create account', () => {
    expect(() => checkTenantSupported('account', 'create')).not.toThrow();
  });

  it('does not throw for push product', () => {
    expect(() => checkTenantSupported('product', 'push')).not.toThrow();
  });
});
