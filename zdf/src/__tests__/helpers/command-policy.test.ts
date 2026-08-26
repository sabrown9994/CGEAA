import { describe, it, expect, beforeEach } from 'vitest';
import {
  RESOURCE_CLASS,
  classifyVerb,
  decideProductionPolicy,
  setInvokedCommand,
  getInvokedCommand,
  resetInvokedCommand,
} from '../../helpers/command-policy.js';

beforeEach(() => {
  resetInvokedCommand();
});

describe('classifyVerb', () => {
  it('classifies pull, list, auth as read', () => {
    expect(classifyVerb('pull')).toBe('read');
    expect(classifyVerb('list')).toBe('read');
    expect(classifyVerb('auth')).toBe('read');
  });

  it('classifies create, push, delete as write', () => {
    expect(classifyVerb('create')).toBe('write');
    expect(classifyVerb('push')).toBe('write');
    expect(classifyVerb('delete')).toBe('write');
  });

  it('classifies an unknown verb as write (safest default)', () => {
    expect(classifyVerb('frobnicate')).toBe('write');
  });
});

describe('RESOURCE_CLASS spot checks', () => {
  it('classifies workflow and billing-template as config', () => {
    expect(RESOURCE_CLASS['workflow']).toBe('config');
    expect(RESOURCE_CLASS['billing-template']).toBe('config');
  });

  it('classifies product-rate-plan-charge as catalog', () => {
    expect(RESOURCE_CLASS['product-rate-plan-charge']).toBe('catalog');
  });

  it('classifies account and bill-run as financial', () => {
    expect(RESOURCE_CLASS['account']).toBe('financial');
    expect(RESOURCE_CLASS['bill-run']).toBe('financial');
  });

  it('classifies data-query as utility', () => {
    expect(RESOURCE_CLASS['data-query']).toBe('utility');
  });
});

describe('decideProductionPolicy', () => {
  it('allows any verb/resource when not production', () => {
    const decision = decideProductionPolicy({
      isProduction: false,
      verb: 'delete',
      resource: 'account',
      allowProdFinancial: false,
    });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('allows pull against production', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'pull',
      resource: 'account',
      allowProdFinancial: false,
    });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('allows list against production', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'list',
      resource: 'orders',
      allowProdFinancial: false,
    });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('blocks create on a financial resource (account) in production without the flag', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'create',
      resource: 'account',
      allowProdFinancial: false,
    });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toMatch(/--allow-prod-financial/);
    }
  });

  it('confirms create on a financial resource (account) in production WITH the flag', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'create',
      resource: 'account',
      allowProdFinancial: true,
    });
    expect(decision).toEqual({ action: 'confirm' });
  });

  it('confirms push on a catalog resource (product) in production', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'push',
      resource: 'product',
      allowProdFinancial: false,
    });
    expect(decision).toEqual({ action: 'confirm' });
  });

  it('confirms push on a config resource (workflow) in production', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'push',
      resource: 'workflow',
      allowProdFinancial: false,
    });
    expect(decision).toEqual({ action: 'confirm' });
  });

  it('confirms create on a utility resource (data-query) in production', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'create',
      resource: 'data-query',
      allowProdFinancial: false,
    });
    expect(decision).toEqual({ action: 'confirm' });
  });

  it('blocks delete on an unknown resource in production (treated as financial)', () => {
    const decision = decideProductionPolicy({
      isProduction: true,
      verb: 'delete',
      resource: 'mystery-resource',
      allowProdFinancial: false,
    });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toMatch(/mystery-resource/);
      expect(decision.reason).toMatch(/delete/);
      expect(decision.reason).toMatch(/--allow-prod-financial/);
    }
  });
});

describe('invoked command module state', () => {
  it('is null by default', () => {
    expect(getInvokedCommand()).toBeNull();
  });

  it('records the verb and resource set via setInvokedCommand', () => {
    setInvokedCommand('push', 'workflow');
    expect(getInvokedCommand()).toEqual({ verb: 'push', resource: 'workflow' });
  });

  it('resetInvokedCommand clears state back to null', () => {
    setInvokedCommand('create', 'account');
    resetInvokedCommand();
    expect(getInvokedCommand()).toBeNull();
  });
});
