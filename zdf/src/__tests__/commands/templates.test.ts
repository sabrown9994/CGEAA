import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockWriteAs = vi.hoisted(() => vi.fn((_r: string, name: string, _body?: unknown) => `MOCK/${name}.json`));
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFileAs: mockWriteAs }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));
vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../api/client.js', () => ({ setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));
vi.mock('../../helpers/dependency-graph.js', () => ({
  setNoDependency: vi.fn(), getLastPulledPath: vi.fn(() => null), setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(), MAX_TRAVERSAL_NODES: 500, FETCH_ALL_ITEMS_MAX: 5000,
}));
const mockSuccess = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/output.js', () => ({ output: { success: mockSuccess, info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { register, templateSuffix } from '../../commands/templates.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf template', () => {
  it('registers exactly the three catalog resources (and nothing else)', () => {
    const p = makeProgram();
    const tmpl = p.commands.find((c) => c.name() === 'template')!;
    expect(tmpl.commands.map((c) => c.name()).sort()).toEqual(['product', 'product-rate-plan', 'product-rate-plan-charge']);
  });

  it('template product writes a template-product-<n>.json skeleton with the Commerce shape', async () => {
    await makeProgram().parseAsync(['node', 'zdf', 'template', 'product']);
    expect(mockWriteAs).toHaveBeenCalledTimes(1);
    const [resource, fileName, body] = mockWriteAs.mock.calls[0];
    expect(resource).toBe('product');
    expect(fileName).toMatch(/^template-product-\d+$/);
    // Commerce shape: snake_case, pricing keyed by currency, full accounting block, custom fields.
    expect(body).toMatchObject({ sku: expect.any(String), plans: expect.any(Array) });
    const charge = (body as any).plans[0].charges[0];
    expect(charge.pricing.flatAmounts).toHaveProperty('USD');
    expect(Object.keys(charge.accounting)).toContain('deferred_revenue_account');
    expect(charge).toHaveProperty('pobidentifier__c');
    // success message tells the user the exact create command to run
    expect(mockSuccess.mock.calls[0][0]).toMatch(/zdf create product template-product-\d+/);
  });

  it('template product-rate-plan and charge write PascalCase object skeletons with required parent ids', async () => {
    await makeProgram().parseAsync(['node', 'zdf', 'template', 'product-rate-plan']);
    expect(mockWriteAs.mock.calls[0][1]).toMatch(/^template-product-rate-plan-\d+$/);
    expect(mockWriteAs.mock.calls[0][2]).toHaveProperty('ProductId');

    mockWriteAs.mockClear();
    await makeProgram().parseAsync(['node', 'zdf', 'template', 'product-rate-plan-charge']);
    const body = mockWriteAs.mock.calls[0][2] as any;
    expect(body).toHaveProperty('ProductRatePlanId');
    expect(body).toHaveProperty('POBIdentifier__c');
    expect(body.ProductRatePlanChargeTierData.ProductRatePlanChargeTier[0]).toHaveProperty('Currency');
  });

  it('templateSuffix is a short numeric string', () => {
    expect(templateSuffix()).toMatch(/^\d{1,5}$/);
  });
});
