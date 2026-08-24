import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';

// REAL-FILESYSTEM integration test for the cross-tenant `_zdf` env map. This deliberately does
// NOT mock file-io.js, dependency-graph.js, env-map.js, upsert.js, or resource-registry.js — it
// exercises the actual read/write/merge code paths against a real temp directory. A prior fix
// round mocked file-io entirely, which let a lookup-key bug (merging by the NEW tenant's internal
// id instead of the record's stable natural key / the in-memory prior map) slip through every
// unit test while still being broken for the real cross-tenant case: a logical record has a
// DIFFERENT internal id per tenant (see zdf/CLAUDE.md), so an id-keyed lookup for the "existing"
// local file misses it entirely.
//
// Only the network layer (api/client.js) and the active-environment selector (auth/config.js)
// are mocked, simulating: a record already pulled from tenant "prod" (recorded in `_zdf.prod`),
// then pushed while the ACTIVE env is "intQA", where the SAME logical record exists under a
// DIFFERENT internal id. The assertion: the final on-disk file carries BOTH `_zdf.prod`
// (preserved) and `_zdf.intQA` (newly added) — the map ACCUMULATED, not overwritten.

const mockGetActiveEnv = vi.hoisted(() => vi.fn());
vi.mock('../../auth/config.js', () => ({ getActiveEnv: mockGetActiveEnv }));

const mockApiGet = vi.hoisted(() => vi.fn());
const mockApiPost = vi.hoisted(() => vi.fn());
const mockApiPut = vi.hoisted(() => vi.fn());
const mockApiDelete = vi.hoisted(() => vi.fn());
const mockApiQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
  apiDelete: mockApiDelete,
  apiQuery: mockApiQuery,
  setDebug: vi.fn(),
  setMaxRows: vi.fn(),
  APIQUERY_MAX_ROWS: 5000,
}));

import { register as registerAccounts } from '../../commands/accounts.js';
import { register as registerProducts } from '../../commands/products.js';
import { readResourceFile, writeResourceFile, resolveFilePath } from '../../helpers/file-io.js';

function makeProgram(register: (p: Command) => void): Command {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = mkdtempSync(join(tmpdir(), 'zdf-cross-tenant-'));
  process.env.ZDF_OUTPUT_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.ZDF_OUTPUT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('cross-tenant _zdf accumulation — account (natural-keyed)', () => {
  it('push under a NEW active env, where the same logical account has a DIFFERENT internal id, preserves the prior env entry AND adds the new one', async () => {
    // Fixture: an account previously pulled from tenant "prod" — internal id 'prod-abc',
    // accountNumber 'ACG1' (the natural key, stable across tenants). Written via the REAL
    // writeResourceFile, so it lands at the natural-key filename exactly as `pull` would.
    writeResourceFile('account', 'prod-abc', {
      basicInfo: { id: 'prod-abc', accountNumber: 'ACG1', name: 'Acme Co' },
      _zdf: { prod: { id: 'prod-abc', key: 'ACG1' } },
    });

    // Active env is now intQA — a DIFFERENT tenant where this same logical account exists under
    // a DIFFERENT internal id ('intqa-999'), discoverable only by its stable natural key.
    mockGetActiveEnv.mockReturnValue({ isProduction: false, name: 'intQA' });
    // resolveTargetId: no _zdf.intQA entry yet -> falls to crossTenantKeyValue + searchByKey.
    mockApiQuery.mockResolvedValue([{ Id: 'intqa-999' }]);
    mockApiPut.mockResolvedValue({ success: true });
    // resolveAndSync's re-fetch (fetchAndWrite) GETs the account fresh from the active tenant.
    mockApiGet.mockResolvedValue({
      basicInfo: { id: 'intqa-999', accountNumber: 'ACG1', name: 'Acme Co' },
      success: true,
    });

    const program = makeProgram(registerAccounts);
    // CLI arg is the STALE prod-tenant id — readResourceFile's findByStoredId fallback locates
    // the natural-key file by matching this stored id.
    await program.parseAsync(['node', 'zdf', 'push', 'account', 'prod-abc']);

    // PUT went to the RESOLVED (intQA) id, not the stale arg.
    expect(mockApiPut).toHaveBeenCalledWith('/v1/accounts/intqa-999', expect.anything());
    // The outbound PUT body must never carry _zdf.
    expect(mockApiPut.mock.calls[0][1]).not.toHaveProperty('_zdf');

    const finalPath = resolveFilePath('account', 'ACG1');
    expect(existsSync(finalPath)).toBe(true);
    const final = readResourceFile('account', 'ACG1') as Record<string, unknown>;
    expect(final['_zdf']).toEqual({
      prod: { id: 'prod-abc', key: 'ACG1' },
      intQA: { id: 'intqa-999', key: 'ACG1' },
    });
  });
});

describe('cross-tenant _zdf accumulation — product (SKU-keyed / natural key)', () => {
  it('push under a NEW active env, where the same logical product has a DIFFERENT internal id, preserves the prior env entry AND adds the new one, on the SAME SKU-named file (no self-delete)', async () => {
    // Fixture: a product previously pulled from tenant "prod" — internal id 'prod-sku-abc',
    // SKU 'SKU1' (the natural key, stable across tenants). product is now SKU-named on disk (like
    // account/invoice/memos) — writeResourceFile derives the filename from the record's SKU, not
    // the id argument passed here.
    writeResourceFile('product', 'prod-sku-abc', {
      Id: 'prod-sku-abc',
      Name: 'Test Product',
      SKU: 'SKU1',
      _zdf: { prod: { id: 'prod-sku-abc', key: 'SKU1' } },
    });
    expect(existsSync(resolveFilePath('product', 'SKU1'))).toBe(true);

    mockGetActiveEnv.mockReturnValue({ isProduction: false, name: 'intQA' });
    // resolveTargetId: no _zdf.intQA entry yet -> falls to crossTenantKeyValue (SKU) + searchByKey.
    // rulesProduct's child ProductRatePlan lookup also goes through apiQuery — branch on content.
    mockApiQuery.mockImplementation((zoql: string) => {
      if (zoql.includes('WHERE SKU')) return Promise.resolve([{ Id: 'intqa-prod-999' }]);
      return Promise.resolve([]); // no product-rate-plan children
    });
    mockApiPut.mockResolvedValue({ Success: true });
    // resolveAndSync's re-fetch (fetchAndWrite) GETs the product fresh from the active tenant —
    // under a DIFFERENT internal id than the prod-tenant file, but the SAME SKU.
    mockApiGet.mockResolvedValue({ Id: 'intqa-prod-999', Name: 'Test Product', SKU: 'SKU1' });

    const program = makeProgram(registerProducts);
    // CLI arg is the natural-key filename ('SKU1') — the realistic invocation now that product is
    // SKU-named, mirroring how account/invoice are pushed by their natural key.
    await program.parseAsync(['node', 'zdf', 'push', 'product', 'SKU1']);

    expect(mockApiPut).toHaveBeenCalledWith('/v1/object/product/intqa-prod-999', expect.anything());
    expect(mockApiPut.mock.calls[0][1]).not.toHaveProperty('_zdf');

    // Regression guard: the resolved internal id ('intqa-prod-999') differs from the CLI arg
    // ('SKU1'), which is exactly the condition that (pre-fix) would have deleted the file
    // resolveAndSync just wrote — because with product now SKU-named, the arg is almost always
    // an internal-id/SKU mismatch even in the SAME-tenant case. The file must survive intact.
    const finalPath = resolveFilePath('product', 'SKU1');
    expect(existsSync(finalPath)).toBe(true);
    const final = readResourceFile('product', 'SKU1') as Record<string, unknown>;
    expect(final['_zdf']).toEqual({
      prod: { id: 'prod-sku-abc', key: 'SKU1' },
      intQA: { id: 'intqa-prod-999', key: 'SKU1' },
    });
    expect(final['Id']).toBe('intqa-prod-999');
  });
});
