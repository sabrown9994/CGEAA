import { describe, it, expect } from 'vitest';
import { assertSuccess } from '../../helpers/zuora-response.js';

describe('assertSuccess', () => {
  it('does not throw when success is true', () => {
    expect(() => assertSuccess({ success: true }, 'account update')).not.toThrow();
  });

  it('throws with label when success is false and no reasons', () => {
    expect(() => assertSuccess({ success: false }, 'account update'))
      .toThrow('Zuora rejected the account update.');
  });

  it('throws with reasons detail when provided', () => {
    expect(() => assertSuccess({
      success: false,
      reasons: [{ code: 58230015, message: 'Name is required.' }],
    }, 'account update')).toThrow('58230015: Name is required.');
  });

  it('falls back to errors array when reasons is absent', () => {
    expect(() => assertSuccess({
      success: false,
      errors: [{ code: 'INVALID', message: 'Bad field.' }],
    }, 'contact create')).toThrow('INVALID: Bad field.');
  });
});
