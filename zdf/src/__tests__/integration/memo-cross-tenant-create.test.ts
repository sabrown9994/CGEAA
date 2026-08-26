import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';

// REAL-FILESYSTEM regression test for a Critical finding on Task 6's review: the sibling-invoice
// lookup inside credit-memos.ts / debit-memos.ts's `resolveTargetInvoiceKey` used
// `readResourceFileIfExists('invoice', sourceInvoiceId)`, which does an EXACT-filename lookup only.
// Invoice files are named by their natural key (invoiceNumber) — NOT the internal id — but
// `resolveSourceInvoiceId` yields an id-shaped value (`--invoice <id>`, or the memo's `invoiceId`
// field). So even when the source invoice WAS pulled/pushed and mapped locally, the exact-filename
// lookup missed it and threw "source invoice not mapped", breaking the primary cross-tenant
// memo-create flow. A blanket-mocked file-io test (as the original Task 6 command tests are) can't
// catch this — the mock always "finds" whatever it's told to return, regardless of id-vs-name. This
// test deliberately does NOT mock file-io.js (or env-map.js / upsert.js / upsert-command.js /
// resource-registry.js) — only the network layer, the active-environment selector, and
// dependency-graph's re-fetch (irrelevant to the bug being regression-tested) are mocked.

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

const mockResolveAndSync = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolveAndSync,
  setNoDependency: vi.fn(),
  getLastPulledPath: vi.fn(() => null),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));

import { register as registerCreditMemos } from '../../commands/credit-memos.js';
import { register as registerDebitMemos } from '../../commands/debit-memos.js';
import { writeResourceFile } from '../../helpers/file-io.js';

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
  mockApiQuery.mockResolvedValue([]); // credit-/debit-memo key search: no match -> upsert falls to CREATE
  tmpDir = mkdtempSync(join(tmpdir(), 'zdf-memo-cross-tenant-'));
  process.env.ZDF_OUTPUT_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.ZDF_OUTPUT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('cross-tenant memo create — sibling invoice looked up by id OR natural key', () => {
  it('credit-memo: resolves the invoiceNumber-named sibling file even though the memo references it by INTERNAL id, and posts remapped items to the correct target invoice key', async () => {
    // Sibling invoice, pulled/mapped into intQA previously: file lands at invoices/INV-1.json
    // (natural-key-named), but its internal id is 'inv-internal-1' — a DIFFERENT value.
    writeResourceFile('invoice', 'inv-internal-1', {
      id: 'inv-internal-1',
      invoiceNumber: 'INV-1',
      _zdf: { intQA: { id: 'intqa-inv-9', key: 'INV-1-INTQA' } },
    });
    expect(existsSync(join(tmpDir, 'invoices', 'INV-1.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'invoices', 'inv-internal-1.json'))).toBe(false);

    // Source memo file: its `invoiceId` is the invoice's INTERNAL id, not its number — the shape
    // resolveSourceInvoiceId derives from a memo record.
    writeResourceFile('credit-memo', 'mem-src-1', {
      memoNumber: 'CM-SRC-1',
      invoiceId: 'inv-internal-1',
      creditMemoItems: [{ invoiceItemId: 'source-item-1', skuName: 'SKU-A', amount: 100 }],
    });

    mockApiGet.mockResolvedValue({ invoiceItems: [{ id: 'target-item-1', skuName: 'SKU-A', amount: 100 }] });
    mockApiPost.mockResolvedValue({ success: true, id: 'new-cm-intqa-id' });
    mockResolveAndSync.mockResolvedValue(undefined);

    await makeProgram(registerCreditMemos).parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-SRC-1']);

    expect(mockApiGet).toHaveBeenCalledWith('/v1/invoices/INV-1-INTQA/items');
    expect(mockApiPost).toHaveBeenCalledWith('/v1/credit-memos/invoice/INV-1-INTQA', {
      items: [{ invoiceItemId: 'target-item-1', amount: 100, skuName: 'SKU-A' }],
    });
    expect(mockResolveAndSync).toHaveBeenCalledWith('credit-memo', 'new-cm-intqa-id', 'push');
  });

  it('debit-memo: same id-vs-natural-key sibling lookup, via an explicit --invoice option', async () => {
    writeResourceFile('invoice', 'inv-internal-2', {
      id: 'inv-internal-2',
      invoiceNumber: 'INV-2',
      _zdf: { intQA: { id: 'intqa-inv-8', key: 'INV-2-INTQA' } },
    });

    writeResourceFile('debit-memo', 'mem-src-2', {
      memoNumber: 'DM-SRC-1',
      debitMemoItems: [{ invoiceItemId: 'source-item-2', skuName: 'SKU-B', amount: 50 }],
    });

    mockApiGet.mockResolvedValue({ invoiceItems: [{ id: 'target-item-2', skuName: 'SKU-B', amount: 50 }] });
    mockApiPost.mockResolvedValue({ success: true, id: 'new-dm-intqa-id' });
    mockResolveAndSync.mockResolvedValue(undefined);

    await makeProgram(registerDebitMemos).parseAsync([
      'node', 'zdf', 'push', 'debit-memo', 'DM-SRC-1', '--invoice', 'inv-internal-2',
    ]);

    expect(mockApiGet).toHaveBeenCalledWith('/v1/invoices/INV-2-INTQA/items');
    expect(mockApiPost).toHaveBeenCalledWith('/v1/debit-memos/invoice/INV-2-INTQA', {
      items: [{ invoiceItemId: 'target-item-2', amount: 50, skuName: 'SKU-B' }],
    });
    expect(mockResolveAndSync).toHaveBeenCalledWith('debit-memo', 'new-dm-intqa-id', 'push');
  });

  it('still throws the clear "not mapped" error when the sibling invoice truly has no local file at all', async () => {
    writeResourceFile('credit-memo', 'mem-src-3', {
      memoNumber: 'CM-SRC-2',
      invoiceId: 'no-such-invoice-id',
      creditMemoItems: [{ skuName: 'SKU-A', amount: 100 }],
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram(registerCreditMemos).parseAsync(['node', 'zdf', 'push', 'credit-memo', 'CM-SRC-2'])
    ).rejects.toThrow('exit');

    expect(mockApiPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
