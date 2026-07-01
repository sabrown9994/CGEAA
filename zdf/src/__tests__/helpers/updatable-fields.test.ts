import { describe, it, expect } from 'vitest';
import { filterUpdatableFields } from '../../helpers/updatable-fields.js';

describe('filterUpdatableFields', () => {
  it('passes through all fields when no filter defined for resource', () => {
    const data = { id: '1', name: 'Test', readOnlyField: 'x' };
    expect(filterUpdatableFields('workflow', data)).toEqual(data);
  });

  it('filters to only allowed fields for account', () => {
    const data = {
      name: 'Test Corp',
      id: '8a8a...',           // read-only, should be removed
      accountNumber: 'ACG123', // read-only, should be removed
      batch: 'Batch1',
      notes: 'Some notes',
    };
    const result = filterUpdatableFields('account', data);
    expect(result).toEqual({ name: 'Test Corp', batch: 'Batch1', notes: 'Some notes' });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('accountNumber');
  });

  it('always allows custom fields ending in __c', () => {
    const data = {
      name: 'Test Corp',
      id: '8a8a...',
      GraceDate__c: '2026-01-01',
      PHStatus__c: 'Active',
    };
    const result = filterUpdatableFields('account', data);
    expect(result).toHaveProperty('GraceDate__c');
    expect(result).toHaveProperty('PHStatus__c');
    expect(result).not.toHaveProperty('id');
  });

  it('returns empty object when no allowed fields match', () => {
    const data = { id: '1', accountNumber: 'ACG123', status: 'Active' };
    const result = filterUpdatableFields('account', data);
    expect(result).toEqual({});
  });

  it('strips null values from allowed fields', () => {
    const data = { name: 'Test Corp', notes: null, batch: 'Batch1', crmId: null };
    const result = filterUpdatableFields('account', data);
    expect(result).toEqual({ name: 'Test Corp', batch: 'Batch1' });
    expect(result).not.toHaveProperty('notes');
    expect(result).not.toHaveProperty('crmId');
  });

  it('strips null values even when no field list defined for resource', () => {
    const data = { id: '1', name: 'Test', emptyField: null };
    const result = filterUpdatableFields('workflow', data);
    expect(result).toEqual({ id: '1', name: 'Test' });
    expect(result).not.toHaveProperty('emptyField');
  });

  it('filters contact to only allowed fields, strips read-only id/accountId/accountNumber', () => {
    const data = { id: '1', accountId: 'acc-1', accountNumber: 'ACG123', firstName: 'Jane', workEmail: 'jane@test.com' };
    const result = filterUpdatableFields('contact', data);
    expect(result).toEqual({ firstName: 'Jane', workEmail: 'jane@test.com' });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('accountId');
    expect(result).not.toHaveProperty('accountNumber');
  });
});
