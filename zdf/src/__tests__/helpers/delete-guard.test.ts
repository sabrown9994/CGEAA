import { describe, it, expect } from 'vitest';
import { checkDeleteAllowed, checkTenantSupported } from '../../helpers/delete-guard.js';

describe('checkDeleteAllowed', () => {
  it('throws for subscription', () => {
    expect(() => checkDeleteAllowed('subscription')).toThrow('not supported');
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

  it('throws for create subscription', () => {
    expect(() => checkTenantSupported('subscription', 'create')).toThrow('not currently supported');
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
