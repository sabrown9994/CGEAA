import { describe, it, expect } from 'vitest';
import { assertSuccess, assertReadSuccess } from '../../helpers/zuora-response.js';

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

describe('assertReadSuccess', () => {
  it('throws when body has a populated reasons array (200-with-error)', () => {
    expect(() => assertReadSuccess({
      success: false,
      reasons: [{ code: 58230015, message: 'Object not found.' }],
    }, 'account fetch')).toThrow('58230015: Object not found.');
  });

  it('throws when success is explicitly false with no reasons', () => {
    expect(() => assertReadSuccess({ success: false }, 'account fetch'))
      .toThrow('Zuora rejected the account fetch.');
  });

  it('throws when body has a populated errors array', () => {
    expect(() => assertReadSuccess({
      errors: [{ code: 'INVALID', message: 'Bad request.' }],
    }, 'workflow fetch')).toThrow('INVALID: Bad request.');
  });

  it('does not throw when there is no success field and no errors (e.g. a workflow object)', () => {
    expect(() => assertReadSuccess({ id: 123, name: 'My Workflow' } as never, 'workflow fetch'))
      .not.toThrow();
  });

  it('does not throw for a normal success:true body', () => {
    expect(() => assertReadSuccess({ success: true, id: 'ACC-001' } as never, 'account fetch'))
      .not.toThrow();
  });

  it('does not throw when reasons/errors arrays are present but empty', () => {
    expect(() => assertReadSuccess({ success: true, reasons: [] }, 'account fetch')).not.toThrow();
  });
});
