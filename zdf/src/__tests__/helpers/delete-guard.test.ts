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
  it('throws for create product', () => {
    expect(() => checkTenantSupported('product', 'create')).toThrow('not currently supported');
  });

  it('throws for create subscription', () => {
    expect(() => checkTenantSupported('subscription', 'create')).toThrow('not currently supported');
  });

  it('throws for create invoice', () => {
    expect(() => checkTenantSupported('invoice', 'create')).toThrow('not currently supported');
  });

  it('does not throw for create account', () => {
    expect(() => checkTenantSupported('account', 'create')).not.toThrow();
  });

  it('does not throw for push product', () => {
    expect(() => checkTenantSupported('product', 'push')).not.toThrow();
  });
});
