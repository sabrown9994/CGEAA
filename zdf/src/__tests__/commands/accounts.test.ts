import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, deleteResourceFile: mockDeleteFile, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT') }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  resolveAndSync: mockResolve,
  setNoDependency: vi.fn(),
  getLastPulledPath: vi.fn(() => null),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

// resolveTargetId is mocked per-test (drives the push upsert branch); crossTenantKeyValue is kept
// real (pure) so the _zdf key stored on write matches production behavior.
const mockResolveTargetId = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/upsert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../helpers/upsert.js')>();
  return { ...actual, resolveTargetId: mockResolveTargetId };
});

import { register } from '../../commands/accounts.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull account', () => {
  it('calls resolveAndSync with pull action and reports success when the top-level fetch succeeds', async () => {
    mockResolve.mockResolvedValue(true);
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'account', 'acc-1']);
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'pull');
  });

  it('throws and exits non-zero without printing success when the top-level fetch fails', async () => {
    mockResolve.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'account', 'acc-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create account', () => {
  it('reads local file, posts to Zuora, renames file to Zuora ID', async () => {
    mockRead.mockReturnValue({ name: 'New Acct' });
    mockPost.mockResolvedValue({ accountId: 'new-zuora-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'account', 'my-draft']);
    expect(mockPost).toHaveBeenCalledWith('/v1/accounts', { name: 'New Acct' });
    expect(mockRename).toHaveBeenCalledWith('account', 'my-draft', 'new-zuora-id');
  });

  it('stores _zdf[<env>] from the create response and writes the file back before renaming', async () => {
    mockRead.mockReturnValue({ name: 'New Acct' });
    mockPost.mockResolvedValue({ accountId: 'new-zuora-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'account', 'my-draft']);
    expect(mockWrite).toHaveBeenCalledWith('account', 'my-draft', expect.objectContaining({
      name: 'New Acct',
      _zdf: { sandbox: { id: 'new-zuora-id', key: null } },
    }));
  });

  it('the body posted to Zuora never carries a _zdf map', async () => {
    mockRead.mockReturnValue({ name: 'New Acct', _zdf: { sandbox: { id: 'old-id', key: 'OLD1' } } });
    mockPost.mockResolvedValue({ accountId: 'new-zuora-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'create', 'account', 'my-draft']);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });
});

describe('zdf delete account', () => {
  it('calls delete endpoint and resolveAndSync with delete action', async () => {
    mockDelete.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'account', 'acc-1']);
    expect(mockDelete).toHaveBeenCalledWith('/v1/accounts/acc-1');
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'delete');
  });
});

describe('zdf push account', () => {
  it('target found: extracts basicInfo, filters to updatable fields, PUTs to the RESOLVED id, and calls resolveAndSync', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'acc-1', found: true });
    mockRead.mockReturnValue({
      basicInfo: {
        id: 'acc-1',            // read-only — should be filtered out
        name: 'Updated Acct',  // updatable — should remain
        batch: 'Batch1',       // updatable — should remain
        accountNumber: 'ACG123', // read-only — should be filtered out
      },
      billingAndPayment: { currency: 'USD' },
    });
    mockPut.mockResolvedValue({ success: true });
    mockResolve.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    expect(mockPut).toHaveBeenCalledWith('/v1/accounts/acc-1', {
      name: 'Updated Acct',
      batch: 'Batch1',
    });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'push');
  });

  it('target found: does NOT write the file directly — resolveAndSync (mocked here) is the sole writer', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'acc-1', found: true });
    mockRead.mockReturnValue({
      basicInfo: { id: 'acc-1', name: 'Updated Acct', accountNumber: 'ACG123' },
    });
    mockPut.mockResolvedValue({ success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    // The command itself must not write the file — that would race/duplicate with
    // resolveAndSync's own re-fetch-and-write (which is what actually populates _zdf, merged
    // with other envs — see dependency-graph.test.ts).
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('account', 'acc-1', 'push');
  });

  it('target found, resolved id differs from the CLI arg: PUTs and syncs using the resolved id, not the arg', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'resolved-id', found: true });
    mockRead.mockReturnValue({
      basicInfo: { id: 'acc-1', name: 'Updated Acct', accountNumber: 'ACG123' },
    });
    mockPut.mockResolvedValue({ success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    expect(mockPut).toHaveBeenCalledWith('/v1/accounts/resolved-id', { name: 'Updated Acct' });
    expect(mockResolve).toHaveBeenCalledWith('account', 'resolved-id', 'push');
  });

  it('target not found: attempts CREATE from the local file body instead of PUT', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ basicInfo: { name: 'Brand New Acct' } });
    mockPost.mockResolvedValue({ accountId: 'created-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    expect(mockPost).toHaveBeenCalledWith('/v1/accounts', { basicInfo: { name: 'Brand New Acct' } });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('target not found: does NOT write the file directly — resolveAndSync (mocked here) re-fetches/writes by the CREATED id', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({ basicInfo: { name: 'Brand New Acct' } });
    mockPost.mockResolvedValue({ accountId: 'created-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('account', 'created-id', 'push');
  });

  it('the body PUT to Zuora on the update path never carries a _zdf map', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'acc-1', found: true });
    mockRead.mockReturnValue({
      basicInfo: { name: 'Updated Acct' },
      _zdf: { sandbox: { id: 'acc-1', key: 'ACG123' } },
    });
    mockPut.mockResolvedValue({ success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });

  it('the body POSTed to Zuora on the create-fallback path never carries a _zdf map', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    mockRead.mockReturnValue({
      basicInfo: { name: 'Brand New Acct' },
      _zdf: { sandbox: { id: 'stale-id', key: 'STALE1' } },
    });
    mockPost.mockResolvedValue({ accountId: 'created-id', success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('_zdf');
  });

  it('exits with error when Zuora returns success false', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'acc-1', found: true });
    mockRead.mockReturnValue({
      basicInfo: { id: 'acc-1', name: 'Test' },
    });
    mockPut.mockResolvedValue({
      success: false,
      reasons: [{ code: 58230015, message: 'Invalid field value.' }],
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('exits with error when basicInfo is missing', async () => {
    mockResolveTargetId.mockResolvedValue({ id: 'acc-1', found: true });
    mockRead.mockReturnValue({ name: 'No basic info here' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('target not found (create branch): deletes the stale source file when the created account is assigned a DIFFERENT accountNumber than the source', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    const sourceRecord = { basicInfo: { accountNumber: 'A-SOURCE', name: 'Brand New Acct' } };
    mockRead.mockImplementation((_resource: string, arg: string) => {
      if (arg === 'acc-1') return sourceRecord;
      if (arg === 'created-id') return { basicInfo: { accountNumber: 'A-TARGET', name: 'Brand New Acct' } };
      return undefined;
    });
    mockPost.mockResolvedValue({ accountId: 'created-id', success: true });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);

    expect(mockDeleteFile).toHaveBeenCalledWith('account', 'acc-1');
  });

  it('target not found (create branch): does NOT delete the source file when the created account keeps the same accountNumber', async () => {
    mockResolveTargetId.mockResolvedValue({ id: null, found: false });
    const sourceRecord = { basicInfo: { accountNumber: 'A-SOURCE', name: 'Brand New Acct' } };
    mockRead.mockImplementation((_resource: string, arg: string) => {
      if (arg === 'acc-1') return sourceRecord;
      if (arg === 'created-id') return { basicInfo: { accountNumber: 'A-SOURCE', name: 'Brand New Acct' } };
      return undefined;
    });
    mockPost.mockResolvedValue({ accountId: 'created-id', success: true });
    mockResolve.mockResolvedValue(undefined);

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'account', 'acc-1']);

    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});
