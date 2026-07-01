import { describe, it, expect } from 'vitest';
import { checkDeleteAllowed } from '../../helpers/delete-guard.js';

describe('checkDeleteAllowed', () => {
  it('throws for subscription', () => {
    expect(() => checkDeleteAllowed('subscription')).toThrow('cannot be deleted');
  });

  it('does not throw for account', () => {
    expect(() => checkDeleteAllowed('account')).not.toThrow();
  });

  it('does not throw for product', () => {
    expect(() => checkDeleteAllowed('product')).not.toThrow();
  });
});
