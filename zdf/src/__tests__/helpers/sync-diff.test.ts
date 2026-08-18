import { describe, it, expect } from 'vitest';
import { RESOURCE_SUBFOLDERS } from '../../constants.js';
import {
  REVERSE_SUBFOLDERS,
  RESOURCE_PRECEDENCE,
  parseNameStatus,
  resolveFileToAction,
  eligibility,
  planFromDiff,
} from '../../helpers/sync-diff.js';

describe('REVERSE_SUBFOLDERS', () => {
  it('is the exact reverse of RESOURCE_SUBFOLDERS for every entry', () => {
    for (const [resource, subfolder] of Object.entries(RESOURCE_SUBFOLDERS)) {
      expect(REVERSE_SUBFOLDERS[subfolder]).toBe(resource);
    }
    expect(Object.keys(REVERSE_SUBFOLDERS).length).toBe(Object.keys(RESOURCE_SUBFOLDERS).length);
  });
});

describe('RESOURCE_PRECEDENCE', () => {
  it('matches the exact documented parents-first order', () => {
    expect(RESOURCE_PRECEDENCE).toEqual([
      'account',
      'contact',
      'product',
      'product-rate-plan',
      'product-rate-plan-charge',
      'order',
      'order-line-item',
      'subscription',
      'bill-run',
      'invoice',
      'credit-memo',
      'debit-memo',
      'workflow',
      'billing-template',
    ]);
  });
});

describe('parseNameStatus', () => {
  it('parses an Added line', () => {
    expect(parseNameStatus('A\tzdf-output/accounts/ACC-1.json')).toEqual([
      { status: 'A', path: 'zdf-output/accounts/ACC-1.json' },
    ]);
  });

  it('parses a Modified line', () => {
    expect(parseNameStatus('M\tzdf-output/accounts/ACC-1.json')).toEqual([
      { status: 'M', path: 'zdf-output/accounts/ACC-1.json' },
    ]);
  });

  it('parses a Deleted line', () => {
    expect(parseNameStatus('D\tzdf-output/accounts/ACC-1.json')).toEqual([
      { status: 'D', path: 'zdf-output/accounts/ACC-1.json' },
    ]);
  });

  it('parses a Renamed line (with score) into a single entry carrying oldPath', () => {
    expect(
      parseNameStatus('R100\tzdf-output/accounts/OLD.json\tzdf-output/accounts/NEW.json')
    ).toEqual([{ status: 'R', path: 'zdf-output/accounts/NEW.json', oldPath: 'zdf-output/accounts/OLD.json' }]);
  });

  it('parses a Copied line (with score) into a single entry carrying oldPath', () => {
    expect(
      parseNameStatus('C075\tzdf-output/accounts/SRC.json\tzdf-output/accounts/DST.json')
    ).toEqual([{ status: 'C', path: 'zdf-output/accounts/DST.json', oldPath: 'zdf-output/accounts/SRC.json' }]);
  });

  it('ignores blank lines', () => {
    expect(parseNameStatus('A\tzdf-output/accounts/A.json\n\n\nM\tzdf-output/accounts/B.json\n')).toHaveLength(2);
  });

  it('skips a malformed line (missing path) without throwing', () => {
    expect(() => parseNameStatus('A\t\nM\tzdf-output/accounts/B.json')).not.toThrow();
    expect(parseNameStatus('A\t\nM\tzdf-output/accounts/B.json')).toEqual([
      { status: 'M', path: 'zdf-output/accounts/B.json' },
    ]);
  });

  it('skips a malformed rename line (missing new path) without throwing', () => {
    expect(parseNameStatus('R100\tzdf-output/accounts/OLD.json')).toEqual([]);
  });

  it('skips an unrecognized status letter', () => {
    expect(parseNameStatus('Z\tzdf-output/accounts/A.json')).toEqual([]);
  });

  it('parses multiple lines together', () => {
    const input = [
      'A\tzdf-output/accounts/ACC-1.json',
      'M\tzdf-output/orders/O-01339581.json',
      'D\tzdf-output/subscriptions/SUB-1.json',
    ].join('\n');
    expect(parseNameStatus(input)).toHaveLength(3);
  });
});

describe('resolveFileToAction', () => {
  it('resolves every RESOURCE_SUBFOLDERS entry except data-query', () => {
    for (const [resource, subfolder] of Object.entries(RESOURCE_SUBFOLDERS)) {
      const result = resolveFileToAction(`zdf-output/${subfolder}/some-id.json`);
      if (resource === 'data-query') {
        expect(result).toEqual({ ignored: true, reason: 'data-query excluded' });
      } else {
        expect(result).toEqual({ resource, id: 'some-id' });
      }
    }
  });

  it('uses the basename as the id for order (order number, not a UUID)', () => {
    expect(resolveFileToAction('zdf-output/orders/O-01339581.json')).toEqual({
      resource: 'order',
      id: 'O-01339581',
    });
  });

  it('uses the substring after the last underscore as the id for billing-template', () => {
    expect(resolveFileToAction('zdf-output/billing-templates/HTML_ZDF_POC_8a8aa02e9fd1.json')).toEqual({
      resource: 'billing-template',
      id: '8a8aa02e9fd1',
    });
  });

  it('handles a billing-template filename with no underscore (whole basename is the id)', () => {
    expect(resolveFileToAction('zdf-output/billing-templates/8a8aa02e9fd1.json')).toEqual({
      resource: 'billing-template',
      id: '8a8aa02e9fd1',
    });
  });

  it('excludes data-query entirely', () => {
    expect(resolveFileToAction('zdf-output/data-queries/job-123.json')).toEqual({
      ignored: true,
      reason: 'data-query excluded',
    });
  });

  it('ignores a path under an unknown subfolder', () => {
    expect(resolveFileToAction('zdf-output/unknown-things/foo.json')).toEqual({
      ignored: true,
      reason: 'not under a known zdf-output subfolder',
    });
  });

  it('ignores a non-.json file', () => {
    expect(resolveFileToAction('zdf-output/accounts/README.md')).toEqual({
      ignored: true,
      reason: 'not a .json file',
    });
  });

  it('ignores a path with fewer than two segments', () => {
    expect(resolveFileToAction('ACC-1.json')).toEqual({
      ignored: true,
      reason: 'not under the zdf-output root',
    });
  });

  it('resolves correctly for a path anchored under an explicit multi-segment root', () => {
    expect(resolveFileToAction('Zuora/zdf-output/accounts/ACC-9.json', 'Zuora/zdf-output')).toEqual({
      resource: 'account',
      id: 'ACC-9',
    });
  });

  it('ignores an identical-looking path that is NOT under the given root', () => {
    expect(resolveFileToAction('other/accounts/ACC-1.json', 'zdf-output')).toEqual({
      ignored: true,
      reason: 'not under the zdf-output root',
    });
  });

  it('defaults root to the OUTPUT_DIR constant ("zdf-output") when root is omitted', () => {
    expect(resolveFileToAction('zdf-output/accounts/ACC-1.json')).toEqual({
      resource: 'account',
      id: 'ACC-1',
    });
    // Same result whether root is passed explicitly or left to the default.
    expect(resolveFileToAction('zdf-output/accounts/ACC-1.json', 'zdf-output')).toEqual(
      resolveFileToAction('zdf-output/accounts/ACC-1.json')
    );
    // A path missing the default root prefix is now ignored (spec rule 1), not misclassified.
    expect(resolveFileToAction('accounts/ACC-1.json')).toEqual({
      ignored: true,
      reason: 'not under the zdf-output root',
    });
  });

  it('normalizes a leading "./" and trailing "/" on root', () => {
    expect(resolveFileToAction('zdf-output/accounts/ACC-1.json', './zdf-output/')).toEqual({
      resource: 'account',
      id: 'ACC-1',
    });
  });
});

describe('eligibility', () => {
  it('excludes data-query for every op', () => {
    expect(eligibility('data-query', 'create')).toEqual({ eligible: false, reason: 'excluded' });
    expect(eligibility('data-query', 'push')).toEqual({ eligible: false, reason: 'excluded' });
    expect(eligibility('data-query', 'delete')).toEqual({ eligible: false, reason: 'excluded' });
  });

  it('skips subscription create and delete (no such command)', () => {
    expect(eligibility('subscription', 'create')).toEqual({
      eligible: false,
      reason: 'no create/delete command for subscription',
    });
    expect(eligibility('subscription', 'delete')).toEqual({
      eligible: false,
      reason: 'no create/delete command for subscription',
    });
  });

  it('allows subscription push', () => {
    expect(eligibility('subscription', 'push')).toEqual({ eligible: true });
  });

  it('excludes create bill-run (executes real billing)', () => {
    expect(eligibility('bill-run', 'create')).toEqual({
      eligible: false,
      reason: 'create bill-run excluded (executes real billing)',
    });
  });

  it('skips push bill-run (re-fetch no-op)', () => {
    expect(eligibility('bill-run', 'push')).toEqual({
      eligible: false,
      reason: 'push bill-run is a re-fetch no-op',
    });
  });

  it('allows delete bill-run', () => {
    expect(eligibility('bill-run', 'delete')).toEqual({ eligible: true });
  });

  it('skips order-line-item create and delete (no such command)', () => {
    expect(eligibility('order-line-item', 'create')).toEqual({
      eligible: false,
      reason: 'no create/delete command for order-line-item',
    });
    expect(eligibility('order-line-item', 'delete')).toEqual({
      eligible: false,
      reason: 'no create/delete command for order-line-item',
    });
  });

  it('allows order-line-item push', () => {
    expect(eligibility('order-line-item', 'push')).toEqual({ eligible: true });
  });

  it('allows normal creates/pushes/deletes for unrestricted resources', () => {
    for (const op of ['create', 'push', 'delete'] as const) {
      expect(eligibility('account', op)).toEqual({ eligible: true });
    }
    expect(eligibility('order', 'create')).toEqual({ eligible: true });
    expect(eligibility('product', 'delete')).toEqual({ eligible: true });
    expect(eligibility('billing-template', 'push')).toEqual({ eligible: true });
  });
});

describe('planFromDiff', () => {
  it('maps A/M/D to create/push/delete', () => {
    const entries = [
      { status: 'A' as const, path: 'zdf-output/accounts/ACC-1.json' },
      { status: 'M' as const, path: 'zdf-output/accounts/ACC-2.json' },
      { status: 'D' as const, path: 'zdf-output/accounts/ACC-3.json' },
    ];
    const plan = planFromDiff(entries);
    const byId = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(byId['ACC-1'].op).toBe('create');
    expect(byId['ACC-2'].op).toBe('push');
    expect(byId['ACC-3'].op).toBe('delete');
  });

  it('decomposes a rename into delete(old) + create(new)', () => {
    const entries = [
      {
        status: 'R' as const,
        path: 'zdf-output/accounts/NEW.json',
        oldPath: 'zdf-output/accounts/OLD.json',
      },
    ];
    const plan = planFromDiff(entries);
    expect(plan).toHaveLength(2);
    const del = plan.find((p) => p.op === 'delete');
    const create = plan.find((p) => p.op === 'create');
    expect(del?.id).toBe('OLD');
    expect(del?.file).toBe('zdf-output/accounts/OLD.json');
    expect(create?.id).toBe('NEW');
    expect(create?.file).toBe('zdf-output/accounts/NEW.json');
  });

  it('maps a copy to create(new)', () => {
    const entries = [
      {
        status: 'C' as const,
        path: 'zdf-output/accounts/DST.json',
        oldPath: 'zdf-output/accounts/SRC.json',
      },
    ];
    const plan = planFromDiff(entries);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ op: 'create', id: 'DST', file: 'zdf-output/accounts/DST.json' });
  });

  it('drops nothing — every input entry appears in the output, including ignored ones', () => {
    const entries = [
      { status: 'A' as const, path: 'zdf-output/accounts/ACC-1.json' },
      { status: 'A' as const, path: 'zdf-output/unknown/thing.json' },
      { status: 'D' as const, path: 'zdf-output/subscriptions/SUB-1.json' },
    ];
    const plan = planFromDiff(entries);
    expect(plan).toHaveLength(3);
    const ignored = plan.find((p) => p.op === 'ignore');
    expect(ignored).toMatchObject({ eligible: false, reason: 'not under a known zdf-output subfolder' });
    const subDelete = plan.find((p) => p.resource === 'subscription');
    expect(subDelete).toMatchObject({
      op: 'delete',
      eligible: false,
      reason: 'no create/delete command for subscription',
    });
  });

  it('orders creates/pushes parents-first per RESOURCE_PRECEDENCE', () => {
    const entries = [
      { status: 'A' as const, path: 'zdf-output/orders/O-1.json' },
      { status: 'A' as const, path: 'zdf-output/accounts/ACC-1.json' },
      { status: 'A' as const, path: 'zdf-output/products/PROD-1.json' },
    ];
    const plan = planFromDiff(entries);
    const resourceOrder = plan.map((p) => p.resource);
    expect(resourceOrder).toEqual(['account', 'product', 'order']);
  });

  it('orders deletes children-first (exact reverse of create/push order)', () => {
    const entries = [
      { status: 'D' as const, path: 'zdf-output/accounts/ACC-1.json' },
      { status: 'D' as const, path: 'zdf-output/orders/O-1.json' },
      { status: 'D' as const, path: 'zdf-output/products/PROD-1.json' },
    ];
    const plan = planFromDiff(entries);
    const resourceOrder = plan.map((p) => p.resource);
    expect(resourceOrder).toEqual(['order', 'product', 'account']);
  });

  it('sorts a mixed diff: all creates/pushes first (parents-first), then all deletes (children-first)', () => {
    const entries = [
      { status: 'D' as const, path: 'zdf-output/accounts/ACC-DEL.json' },
      { status: 'A' as const, path: 'zdf-output/orders/O-NEW.json' },
      { status: 'M' as const, path: 'zdf-output/accounts/ACC-PUSH.json' },
      { status: 'D' as const, path: 'zdf-output/orders/O-DEL.json' },
      { status: 'A' as const, path: 'zdf-output/accounts/ACC-NEW.json' },
    ];
    const plan = planFromDiff(entries);
    const ops = plan.map((p) => `${p.op}:${p.resource}`);
    // creates+pushes (account, account, order) before deletes (order, account)
    expect(ops.slice(0, 3).every((o) => o.startsWith('create') || o.startsWith('push'))).toBe(true);
    expect(ops.slice(3)).toEqual(['delete:order', 'delete:account']);
    // within the create/push group, account (parent) precedes order (child)
    const accountIdx = ops.findIndex((o) => o === 'create:account' || o === 'push:account');
    const orderIdx = ops.findIndex((o) => o === 'create:order');
    expect(accountIdx).toBeLessThan(orderIdx);
  });

  it('sorts ignored entries last, in original input order', () => {
    const entries = [
      { status: 'A' as const, path: 'zdf-output/unknown-a/x.json' },
      { status: 'A' as const, path: 'zdf-output/accounts/ACC-1.json' },
      { status: 'A' as const, path: 'zdf-output/unknown-b/y.json' },
    ];
    const plan = planFromDiff(entries);
    expect(plan[0]).toMatchObject({ op: 'create', resource: 'account' });
    expect(plan[1].file).toBe('zdf-output/unknown-a/x.json');
    expect(plan[2].file).toBe('zdf-output/unknown-b/y.json');
  });
});
