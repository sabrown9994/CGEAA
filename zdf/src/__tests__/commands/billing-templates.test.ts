import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({
  writeResourceFile: mockWrite,
  resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`),
  getOutputDir: vi.fn(() => 'MOCK_OUTPUT'),
}));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));
vi.mock('../../helpers/dependency-graph.js', () => ({
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
  setMaxTraversalNodes: vi.fn(),
  setMaxItems: vi.fn(),
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: mockReadFileSync, readdirSync: mockReaddirSync, existsSync: mockExistsSync };
});

import { register } from '../../commands/billing-templates.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

const DESIGN_JSON = { design: { blocks: ['a', 'b'] } };
const DESIGN_B64 = Buffer.from(JSON.stringify(DESIGN_JSON), 'utf-8').toString('base64');

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
});

describe('zdf pull billing-template', () => {
  it('decodes base64 content and writes the decoded design JSON (not the metadata wrapper)', async () => {
    mockGet.mockResolvedValue({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: DESIGN_B64,
    });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-1']);
    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
    expect(mockWrite).toHaveBeenCalledWith('billing-template', 'Invoice-Template_bt-1', DESIGN_JSON);
  });

  it('URL-encodes the id in the GET request path', async () => {
    mockGet.mockResolvedValue({
      id: 'bt/1 2',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: DESIGN_B64,
    });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt/1 2']);
    expect(mockGet).toHaveBeenCalledWith(`/settings/invoice-templates/${encodeURIComponent('bt/1 2')}`);
  });

  it('sanitizes non-filename-safe characters in the template name', async () => {
    mockGet.mockResolvedValue({
      id: 'bt-2',
      name: 'Invoice / Template: v2',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: DESIGN_B64,
    });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-2']);
    const [, fileId] = mockWrite.mock.calls[0];
    expect(fileId).toBe('Invoice---Template--v2_bt-2');
  });

  it('rejects a WORD-format template and writes nothing', async () => {
    mockGet.mockResolvedValue({
      id: 'bt-3',
      name: 'Word Template',
      templateFormat: 'WORD',
      base64EncodedTemplateFileContent: Buffer.from('binary-doc-bytes').toString('base64'),
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-3'])
    ).rejects.toThrow('exit');
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('rejects decoded content that is not valid JSON and writes nothing', async () => {
    mockGet.mockResolvedValue({
      id: 'bt-4',
      name: 'Broken Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: Buffer.from('not json at all').toString('base64'),
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-4'])
    ).rejects.toThrow('exit');
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('does not write and exits non-zero when Zuora returns success:false', async () => {
    mockGet.mockResolvedValue({ success: false, reasons: [{ code: 'INVALID', message: 'Bad id.' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bad-id'])
    ).rejects.toThrow('exit');
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf list billing-templates', () => {
  it('hits GET /settings/invoice-templates and prints metadata', async () => {
    mockGet.mockResolvedValue([
      { id: 'bt-1', name: 'Invoice Template', templateNumber: 'TN-1', templateFormat: 'HTML' },
      { id: 'bt-2', name: 'Word Template', templateNumber: 'TN-2', templateFormat: 'WORD' },
    ]);
    await makeProgram().parseAsync(['node', 'zdf', 'list', 'billing-templates']);
    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('zdf update billing-template', () => {
  it('reads the local file, base64-encodes it, and PUTs to /settings/invoice-templates/{id} with the content in the right field', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: 'stale-b64-should-be-overwritten',
    });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1']);

    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [url, body] = mockPut.mock.calls[0];
    expect(url).toBe('/settings/invoice-templates/bt-1');
    expect(body.base64EncodedTemplateFileContent).toBe(DESIGN_B64);
    expect(body.name).toBe('Invoice Template');
  });

  it('builds the PUT body from an allowlist: excludes extraneous/read-only keys the live Settings API rejects', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      templateNumber: 'TN-1',
      updatedOn: '2026-01-01T00:00:00.000Z',
      associatedToBillingAccount: false,
      templateFileName: 'design.json',
      defaultTemplate: false,
      suppressZeroValueLine: true,
      base64EncodedTemplateFileContent: 'stale-b64-should-be-overwritten',
    });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1']);

    const [, body] = mockPut.mock.calls[0];
    // Confirmed-rejected by live intQA (400 INVALID_USER_INPUT: extraneous key) plus read-only /
    // path-redundant fields must never be sent.
    expect(body).not.toHaveProperty('associatedToBillingAccount');
    expect(body).not.toHaveProperty('templateFormat');
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('templateNumber');
    expect(body).not.toHaveProperty('updatedOn');
    // Documented request-body fields must be carried forward.
    expect(body).toHaveProperty('base64EncodedTemplateFileContent', DESIGN_B64);
    expect(body).toHaveProperty('name', 'Invoice Template');
    expect(body).toHaveProperty('templateFileName', 'design.json');
    expect(body).toHaveProperty('defaultTemplate', false);
    expect(body).toHaveProperty('suppressZeroValueLine', true);
  });

  it('URL-encodes the id in both the GET and PUT request paths', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt/1 2', name: 'Invoice Template', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt/1 2', '--file', '/tmp/custom.json']);

    const encoded = encodeURIComponent('bt/1 2');
    expect(mockGet).toHaveBeenCalledWith(`/settings/invoice-templates/${encoded}`);
    expect(mockPut).toHaveBeenCalledWith(`/settings/invoice-templates/${encoded}`, expect.anything());
  });

  it('supports --file to override the local file lookup', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt-1', name: 'Invoice Template', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1', '--file', '/tmp/custom.json']);

    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/custom.json', 'utf-8');
    const [, body] = mockPut.mock.calls[0];
    expect(body.base64EncodedTemplateFileContent).toBe(DESIGN_B64);
  });

  it('errors and does not PUT when the current template is WORD format', async () => {
    mockReaddirSync.mockReturnValue(['Word_Template_bt-2.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt-2', name: 'Word Template', templateFormat: 'WORD' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-2'])
    ).rejects.toThrow('exit');
    expect(mockPut).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('errors when the local JSON file is malformed', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue('{not valid json');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('errors when no local file matches the id and --file is not provided', async () => {
    mockReaddirSync.mockReturnValue(['Some_Other_Template_bt-9.json']);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    expect(mockPut).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('treats a PUT response with no `success` field (the real Settings API echo) as success', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt-1', name: 'Invoice Template', templateFormat: 'HTML' });
    // No `success` key at all — just the echoed resource, as the live Settings API returns.
    mockPut.mockResolvedValue({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: DESIGN_B64,
    });

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1'])
    ).resolves.toBeDefined();
    expect(mockPut).toHaveBeenCalledTimes(1);
  });

  it('still fails when the PUT response has a `reasons`/`errors` array even without `success:false`', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt-1', name: 'Invoice Template', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ reasons: [{ code: 'INVALID', message: 'Bad field.' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('billing-template round-trip', () => {
  it('decode(pull) -> encode(update) of the same JSON is stable (same base64 in === out)', async () => {
    // Pull: decode
    mockGet.mockResolvedValueOnce({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: DESIGN_B64,
    });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-1']);
    const [, , writtenJson] = mockWrite.mock.calls[0];
    expect(writtenJson).toEqual(DESIGN_JSON);

    // Update: re-encode the same (unchanged) content and confirm the base64 matches exactly
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(writtenJson));
    mockGet.mockResolvedValue({ id: 'bt-1', name: 'Invoice Template', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'update', 'billing-template', 'bt-1']);
    const [, body] = mockPut.mock.calls[0];
    expect(body.base64EncodedTemplateFileContent).toBe(DESIGN_B64);
  });
});
