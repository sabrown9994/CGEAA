import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';

// REAL-FILESYSTEM regression test for Critical 2 (non-idempotent push-create -> duplicate
// financial records on repeat push): the push UPSERT CREATE branch (target not found -> create)
// used to write the NEW record under the created record's server-assigned natural key (e.g. a new
// invoiceNumber, tenant-assigned and almost never equal to the source's), but left the ORIGINAL
// source file — the one the CLI arg pointed at — untouched on disk. A repeat `push <arg>` would
// re-read that stale file (still unmapped for this env, still keyed by the OLD natural key),
// resolveTargetId would report not-found AGAIN, and the command would CREATE A DUPLICATE. Every
// repeat push created another duplicate invoice — unbounded.
//
// This deliberately does NOT mock file-io.js / dependency-graph.js / env-map.js / upsert.js /
// upsert-command.js / resource-registry.js — only the network layer and the active-environment
// selector are mocked — so the real write-then-delete-stale-source sequence is exercised exactly
// as `push invoice` would run it.

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

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));

import { register as registerInvoices } from '../../commands/invoices.js';
import { writeResourceFile, resolveFilePath } from '../../helpers/file-io.js';

function makeProgram(register: (p: Command) => void): Command {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveEnv.mockReturnValue({ isProduction: false, name: 'intQA' });
  // No _zdf.intQA entry on the source file yet, and the key search finds nothing -> resolveTargetId
  // falls to CREATE.
  mockApiQuery.mockResolvedValue([]);
  tmpDir = mkdtempSync(join(tmpdir(), 'zdf-push-create-cleanup-'));
  process.env.ZDF_OUTPUT_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.ZDF_OUTPUT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('push invoice — CREATE branch cleans up the stale source file (no duplicate on repeat push)', () => {
  it('deletes the old invoiceNumber-keyed source file and writes the new one under the target-assigned invoiceNumber; a repeat push of the old arg fails loudly instead of duplicate-creating', async () => {
    // Sibling account file mapped into the active env, so the invoice CREATE branch can resolve its
    // accountId FK to the target-tenant accountNumber (a real pulled invoice references its account
    // by accountId, not accountNumber). findByStoredId matches it by basicInfo.id.
    writeResourceFile('account', 'A-TGT', {
      basicInfo: { id: 'acct-src-id', accountNumber: 'A-TGT', name: 'Sibling Acct' },
      _zdf: { intQA: { id: 'acct-src-id', key: 'A-TGT' } },
    });
    // Source invoice file: references its account by accountId (the pulled shape). This test stays
    // focused on the stale-file cleanup itself.
    writeResourceFile('invoice', 'INV-SRC', {
      invoiceNumber: 'INV-SRC',
      accountId: 'acct-src-id',
      invoiceDate: '2026-08-21',
      invoiceItems: [{ amount: 10 }],
    });
    expect(existsSync(resolveFilePath('invoice', 'INV-SRC'))).toBe(true);

    mockApiPost.mockResolvedValue({ success: true, id: 'target-inv-id' });
    // resolveAndSync's re-fetch (fetchAndWrite) GETs the freshly created invoice from the active
    // tenant — assigned a DIFFERENT (tenant-generated) invoiceNumber than the source's.
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/v1/invoices/target-inv-id') {
        return Promise.resolve({ success: true, id: 'target-inv-id', invoiceNumber: 'INV-TARGET-999' });
      }
      if (url === '/v1/invoices/target-inv-id/items') {
        return Promise.resolve({ invoiceItems: [] });
      }
      return Promise.resolve({ success: false });
    });

    await makeProgram(registerInvoices).parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-SRC']);

    // toInvoiceCreateBody adapts the pulled shape for the create API — invoiceNumber is the
    // OLD, tenant-assigned natural key (exactly the kind of read-only source field the adapter
    // drops; Zuora assigns a fresh one on create), so it must NOT appear in the create body.
    expect(mockApiPost).toHaveBeenCalledWith('/v1/invoices', expect.objectContaining({
      accountNumber: 'A-TGT',
      invoiceDate: '2026-08-21',
      invoiceItems: [{ amount: 10 }],
    }));
    expect(mockApiPost.mock.calls[0][1]).not.toHaveProperty('invoiceNumber');

    // The stale source file (keyed by the OLD invoiceNumber) must be gone.
    expect(existsSync(resolveFilePath('invoice', 'INV-SRC'))).toBe(false);
    // The NEW file, keyed by the target tenant's assigned invoiceNumber, is the sole survivor.
    expect(existsSync(resolveFilePath('invoice', 'INV-TARGET-999'))).toBe(true);

    // A repeat push of the OLD arg must fail loudly (no local file to read) rather than silently
    // re-creating — proving the duplicate-create bug is closed.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram(registerInvoices).parseAsync(['node', 'zdf', 'push', 'invoice', 'INV-SRC'])
    ).rejects.toThrow('exit');
    // Only the ONE create from the first push ever happened.
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    exitSpy.mockRestore();
  });
});
