import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({
  writeResourceFile: mockWrite,
  renameResourceFile: mockRename,
  resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`),
  getOutputDir: vi.fn(() => 'MOCK_OUTPUT'),
}));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));
vi.mock('../../helpers/output.js', () => ({
  output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
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
const mockUnlinkSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
    existsSync: mockExistsSync,
    unlinkSync: mockUnlinkSync,
  };
});

import { register } from '../../commands/billing-templates.js';
import { output } from '../../helpers/output.js';

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
  it('decodes base64 content and writes the decoded design JSON with type marker', async () => {
    mockGet.mockResolvedValue({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: DESIGN_B64,
    });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-1']);
    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
    expect(mockWrite).toHaveBeenCalledWith('billing-template', 'Invoice-Template_bt-1', { ...DESIGN_JSON, _zdfTemplateType: 'invoice' });
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

describe('zdf push billing-template', () => {
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

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1']);

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

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1']);

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

  it('passes through custom fields (__c suffix) in addition to the documented allowlist', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      defaultTemplate: false,
      MyCustomField__c: 'custom-value',
      AnotherOne__c: 42,
      base64EncodedTemplateFileContent: 'stale-b64-should-be-overwritten',
    });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1']);

    const [, body] = mockPut.mock.calls[0];
    expect(body).toHaveProperty('MyCustomField__c', 'custom-value');
    expect(body).toHaveProperty('AnotherOne__c', 42);
    // Still excludes the known-rejected keys.
    expect(body).not.toHaveProperty('templateFormat');
    expect(body).not.toHaveProperty('id');
  });

  it('URL-encodes the id in both the GET and PUT request paths', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt/1 2', name: 'Invoice Template', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt/1 2', '--file', '/tmp/custom.json']);

    const encoded = encodeURIComponent('bt/1 2');
    expect(mockGet).toHaveBeenCalledWith(`/settings/invoice-templates/${encoded}`);
    expect(mockPut).toHaveBeenCalledWith(`/settings/invoice-templates/${encoded}`, expect.anything());
  });

  it('supports --file to override the local file lookup', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt-1', name: 'Invoice Template', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1', '--file', '/tmp/custom.json']);

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
      makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-2'])
    ).rejects.toThrow('exit');
    expect(mockPut).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('errors when the local JSON file is malformed', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue('{not valid json');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('errors when no local file matches the id and --file is not provided', async () => {
    mockReaddirSync.mockReturnValue(['Some_Other_Template_bt-9.json']);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1'])
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
      makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1'])
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
      makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('zdf create billing-template', () => {
  it('re-encodes the local design JSON to base64 and POSTs to /settings/invoice-templates with templateFormat HTML', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockPost.mockResolvedValue({ id: 'bt-new', name: 'New Template', templateFormat: 'HTML' });

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'New Template']);

    expect(mockReadFileSync).toHaveBeenCalledWith('MOCK_OUTPUT/billing-templates/New-Template.json', 'utf-8');
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('/settings/invoice-templates');
    expect(body.name).toBe('New Template');
    expect(body.templateFormat).toBe('HTML');
    // The POST body must carry the base64-encoded content, never the raw JSON.
    expect(body.base64EncodedTemplateFileContent).toBe(DESIGN_B64);
    expect(body).not.toHaveProperty('design');
  });

  it('renames the local file to <name>_<id>.json after a successful create', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockPost.mockResolvedValue({ id: 'bt-new', name: 'New Template', templateFormat: 'HTML' });

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'New Template']);

    expect(mockRename).toHaveBeenCalledWith('billing-template', 'New-Template', 'New-Template_bt-new');
  });

  it('create with a name containing a space renames to the sanitized <name>_<id>.json without throwing (BUG 1)', async () => {
    // Reproduces the orphaned-remote-record bug: a template named "HTML - ZDF POC" has a space
    // and a hyphen surrounded by spaces, which file-io.ts's sanitizeSegment (used under the hood
    // by renameResourceFile in the real implementation) rejects outright. The create path must
    // sanitize the name the same way pull does (sanitizeNameForFilename) before ever handing it
    // to a sanitizeSegment-backed file-io call, both for the default read path and the rename.
    const name = 'HTML - ZDF POC';
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockPost.mockResolvedValue({ id: 'bt-new', name, templateFormat: 'HTML' });

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', name])
    ).resolves.toBeDefined();

    expect(mockReadFileSync).toHaveBeenCalledWith('MOCK_OUTPUT/billing-templates/HTML---ZDF-POC.json', 'utf-8');
    expect(mockRename).toHaveBeenCalledWith('billing-template', 'HTML---ZDF-POC', 'HTML---ZDF-POC_bt-new');
  });

  it('carries forward optional create fields present in the design JSON', async () => {
    const jsonWithOptions = { ...DESIGN_JSON, defaultTemplate: true, suppressZeroValueLine: true, templateFileName: 'x.html' };
    mockReadFileSync.mockReturnValue(JSON.stringify(jsonWithOptions));
    mockPost.mockResolvedValue({ id: 'bt-new', name: 'New Template', templateFormat: 'HTML' });

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'New Template']);

    const [, body] = mockPost.mock.calls[0];
    expect(body.defaultTemplate).toBe(true);
    expect(body.suppressZeroValueLine).toBe(true);
    expect(body.templateFileName).toBe('x.html');
  });

  it('supports --file to override the default local file lookup and writes (not renames) on success', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockPost.mockResolvedValue({ id: 'bt-new', name: 'New Template', templateFormat: 'HTML' });

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'New Template', '--file', '/tmp/custom.json']);

    expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/custom.json', 'utf-8');
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledWith('billing-template', 'New-Template_bt-new', DESIGN_JSON);
  });

  it('errors and does not POST when the default local file is missing and --file is not provided', async () => {
    mockExistsSync.mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'New Template'])
    ).rejects.toThrow('exit');
    expect(mockPost).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('does not rename and exits non-zero when Zuora returns success:false', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockPost.mockResolvedValue({ success: false, reasons: [{ code: 'INVALID', message: 'Bad name.' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'New Template'])
    ).rejects.toThrow('exit');
    expect(mockRename).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf delete billing-template', () => {
  it('DELETEs /settings/invoice-templates/{id} (url-encoded) and removes the local file', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockDelete.mockResolvedValue({ id: 'bt-1' });

    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-1']);

    expect(mockDelete).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
    expect(mockUnlinkSync).toHaveBeenCalledWith('MOCK_OUTPUT/billing-templates/Invoice_Template_bt-1.json');
  });

  it('url-encodes an id with special characters in the DELETE path', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockDelete.mockResolvedValue({ id: 'bt/1 2' });

    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt/1 2']);

    expect(mockDelete).toHaveBeenCalledWith(`/settings/invoice-templates/${encodeURIComponent('bt/1 2')}`);
  });

  it('still succeeds and skips unlink when no local file matches the id (remote delete still proceeds)', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockDelete.mockResolvedValue({ id: 'bt-9' });

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-9'])
    ).resolves.toBeDefined();
    expect(mockDelete).toHaveBeenCalledWith('/settings/invoice-templates/bt-9');
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(output.warn).not.toHaveBeenCalled();
  });

  it('surfaces a warning (not silence) when multiple local files match the id, but still succeeds (BUG 2)', async () => {
    // The "no local file" case and the "ambiguous match" case were previously conflated by a
    // blanket try/catch. A missing file is fine to ignore, but an ambiguous match should still
    // be surfaced to the user rather than silently discarded the same way.
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json', 'Old_Invoice_Template_bt-1.json']);
    mockDelete.mockResolvedValue({ id: 'bt-1' });

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-1'])
    ).resolves.toBeDefined();

    expect(mockDelete).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(output.warn).toHaveBeenCalledTimes(1);
    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('Multiple local files match billing template bt-1'));
  });

  it('does not unlink and exits non-zero when Zuora returns success:false', async () => {
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockDelete.mockResolvedValue({ success: false, reasons: [{ code: 'INVALID', message: 'Cannot delete.' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    expect(mockUnlinkSync).not.toHaveBeenCalled();
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
    expect(writtenJson).toEqual({ ...DESIGN_JSON, _zdfTemplateType: 'invoice' });

    // Update: re-encode the same (unchanged) content and confirm the base64 matches exactly
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['Invoice_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(writtenJson));
    mockGet.mockResolvedValue({ id: 'bt-1', name: 'Invoice Template', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ success: true });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1']);
    const [, body] = mockPut.mock.calls[0];
    expect(body.base64EncodedTemplateFileContent).toBe(DESIGN_B64);
  });
});

describe('billing-template type detection and marker', () => {
  it('pull writes _zdfTemplateType: "invoice" when invoice endpoint succeeds first', async () => {
    mockGet.mockResolvedValue({
      id: 'bt-1',
      name: 'Invoice Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: DESIGN_B64,
    });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-1']);
    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
    const [, , writtenJson] = mockWrite.mock.calls[0];
    expect(writtenJson).toHaveProperty('_zdfTemplateType', 'invoice');
    expect(writtenJson).toHaveProperty('design');
  });

  it('pull writes _zdfTemplateType: "credit-memo" when invoice fails with 400 and credit-memo succeeds', async () => {
    mockGet
      .mockRejectedValueOnce({ statusCode: 400, message: 'Not found' })
      .mockResolvedValueOnce({
        id: 'bt-2',
        name: 'Credit Memo Template',
        templateFormat: 'HTML',
        base64EncodedTemplateFileContent: DESIGN_B64,
      });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-2']);
    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-2');
    expect(mockGet).toHaveBeenCalledWith('/settings/credit-memo-templates/bt-2');
    const [, , writtenJson] = mockWrite.mock.calls[0];
    expect(writtenJson).toHaveProperty('_zdfTemplateType', 'credit-memo');
  });

  it('pull writes _zdfTemplateType: "debit-memo" when invoice and credit-memo fail with 404 and debit-memo succeeds', async () => {
    mockGet
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce({
        id: 'bt-3',
        name: 'Debit Memo Template',
        templateFormat: 'HTML',
        base64EncodedTemplateFileContent: DESIGN_B64,
      });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-3']);
    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-3');
    expect(mockGet).toHaveBeenCalledWith('/settings/credit-memo-templates/bt-3');
    expect(mockGet).toHaveBeenCalledWith('/settings/debit-memo-templates/bt-3');
    const [, , writtenJson] = mockWrite.mock.calls[0];
    expect(writtenJson).toHaveProperty('_zdfTemplateType', 'debit-memo');
  });

  it('pull throws combined not-found error when all three endpoints return 404', async () => {
    mockGet
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockRejectedValueOnce({ statusCode: 404 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-missing'])
    ).rejects.toThrow('exit');
    expect(mockWrite).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('No billing template found for id "bt-missing"'));
    exitSpy.mockRestore();
  });

  it('pull rethrows auth/server errors (statusCode 401) immediately without trying remaining endpoints', async () => {
    mockGet.mockRejectedValueOnce({ statusCode: 401, message: 'Unauthorized' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('billing-template type-aware push', () => {
  it('push with _zdfTemplateType: "credit-memo" uses credit-memo endpoints and strips marker from sent content', async () => {
    const fileContent = { ...DESIGN_JSON, _zdfTemplateType: 'credit-memo' };
    mockReaddirSync.mockReturnValue(['Credit_Memo_Template_bt-2.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(fileContent));
    mockGet.mockResolvedValue({
      id: 'bt-2',
      name: 'Credit Memo Template',
      templateFormat: 'HTML',
      base64EncodedTemplateFileContent: 'stale',
    });
    mockPut.mockResolvedValue({ id: 'bt-2' });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-2']);

    expect(mockGet).toHaveBeenCalledWith('/settings/credit-memo-templates/bt-2');
    expect(mockPut).toHaveBeenCalledWith('/settings/credit-memo-templates/bt-2', expect.anything());
    const [, body] = mockPut.mock.calls[0];
    const decoded = JSON.parse(Buffer.from(body.base64EncodedTemplateFileContent, 'base64').toString('utf-8'));
    expect(decoded).not.toHaveProperty('_zdfTemplateType');
    expect(decoded).toHaveProperty('design');
  });

  it('push without _zdfTemplateType marker defaults to invoice endpoint (backward compat)', async () => {
    mockReaddirSync.mockReturnValue(['Legacy_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockGet.mockResolvedValue({ id: 'bt-1', name: 'Legacy', templateFormat: 'HTML' });
    mockPut.mockResolvedValue({ id: 'bt-1' });

    await makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1']);

    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
    expect(mockPut).toHaveBeenCalledWith('/settings/invoice-templates/bt-1', expect.anything());
  });
});

describe('billing-template type-aware create', () => {
  it('create with _zdfTemplateType: "debit-memo" POSTs to debit-memo endpoint and strips marker', async () => {
    const fileContent = { ...DESIGN_JSON, _zdfTemplateType: 'debit-memo' };
    mockReadFileSync.mockReturnValue(JSON.stringify(fileContent));
    mockPost.mockResolvedValue({ id: 'bt-new', name: 'Debit Memo Template', templateFormat: 'HTML' });

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'Debit Memo Template']);

    expect(mockPost).toHaveBeenCalledWith('/settings/debit-memo-templates', expect.anything());
    const [, body] = mockPost.mock.calls[0];
    const decoded = JSON.parse(Buffer.from(body.base64EncodedTemplateFileContent, 'base64').toString('utf-8'));
    expect(decoded).not.toHaveProperty('_zdfTemplateType');
    expect(decoded).toHaveProperty('design');
  });

  it('create without _zdfTemplateType marker defaults to invoice endpoint', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockPost.mockResolvedValue({ id: 'bt-new', name: 'New Template', templateFormat: 'HTML' });

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'New Template']);

    expect(mockPost).toHaveBeenCalledWith('/settings/invoice-templates', expect.anything());
  });

  it('create does not carry _zdfTemplateType into optional-fields body even when present in design JSON', async () => {
    const fileContent = {
      ...DESIGN_JSON,
      _zdfTemplateType: 'credit-memo',
      defaultTemplate: true,
      suppressZeroValueLine: false,
    };
    mockReadFileSync.mockReturnValue(JSON.stringify(fileContent));
    mockPost.mockResolvedValue({ id: 'bt-new', name: 'Credit Memo Template', templateFormat: 'HTML' });

    await makeProgram().parseAsync(['node', 'zdf', 'create', 'billing-template', 'Credit Memo Template']);

    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty('_zdfTemplateType');
    expect(body).toHaveProperty('defaultTemplate', true);
    expect(body).toHaveProperty('suppressZeroValueLine', false);
  });
});

describe('billing-template type-aware delete', () => {
  it('delete with _zdfTemplateType: "credit-memo" in local file uses credit-memo endpoint', async () => {
    const fileContent = { ...DESIGN_JSON, _zdfTemplateType: 'credit-memo' };
    mockReaddirSync.mockReturnValue(['Credit_Memo_Template_bt-2.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(fileContent));
    mockDelete.mockResolvedValue({ id: 'bt-2' });

    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-2']);

    expect(mockDelete).toHaveBeenCalledWith('/settings/credit-memo-templates/bt-2');
  });

  it('delete with no local file detects type via GET endpoints before deleting', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockGet
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce({
        id: 'bt-2',
        name: 'Credit Memo Template',
        templateFormat: 'HTML',
        base64EncodedTemplateFileContent: DESIGN_B64,
      });
    mockDelete.mockResolvedValue({ id: 'bt-2' });

    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-2']);

    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates/bt-2');
    expect(mockGet).toHaveBeenCalledWith('/settings/credit-memo-templates/bt-2');
    expect(mockDelete).toHaveBeenCalledWith('/settings/credit-memo-templates/bt-2');
  });

  it('delete without marker in local file defaults to invoice endpoint', async () => {
    mockReaddirSync.mockReturnValue(['Legacy_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(DESIGN_JSON));
    mockDelete.mockResolvedValue({ id: 'bt-1' });

    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-1']);

    expect(mockDelete).toHaveBeenCalledWith('/settings/invoice-templates/bt-1');
  });
});

describe('billing-template type-aware list', () => {
  it('list fetches all three endpoint families and prints each with type prefix', async () => {
    mockGet
      .mockResolvedValueOnce([
        { id: 'bt-1', name: 'Invoice Template', templateNumber: 'TN-1', templateFormat: 'HTML' },
        { id: 'bt-2', name: 'Invoice WORD', templateNumber: 'TN-2', templateFormat: 'WORD' },
      ])
      .mockResolvedValueOnce([
        { id: 'cm-1', name: 'Credit Memo Template', templateNumber: 'TN-3', templateFormat: 'HTML' },
      ])
      .mockResolvedValueOnce([
        { id: 'dm-1', name: 'Debit Memo Template', templateNumber: 'TN-4', templateFormat: 'HTML' },
      ]);

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'billing-templates']);

    expect(mockGet).toHaveBeenCalledWith('/settings/invoice-templates');
    expect(mockGet).toHaveBeenCalledWith('/settings/credit-memo-templates');
    expect(mockGet).toHaveBeenCalledWith('/settings/debit-memo-templates');
    expect(output.info).toHaveBeenCalledWith('invoice          bt-1  Invoice Template  #TN-1  HTML');
    expect(output.info).toHaveBeenCalledWith('invoice          bt-2  Invoice WORD  #TN-2  WORD  (not pullable — WORD format)');
    expect(output.info).toHaveBeenCalledWith('credit-memo      cm-1  Credit Memo Template  #TN-3  HTML');
    expect(output.info).toHaveBeenCalledWith('debit-memo       dm-1  Debit Memo Template  #TN-4  HTML');
    expect(output.success).toHaveBeenCalledWith('Fetched 4 billing templates.');
  });

  it('list continues and warns when one family fetch fails', async () => {
    mockGet
      .mockResolvedValueOnce([{ id: 'bt-1', name: 'Invoice', templateNumber: 'TN-1', templateFormat: 'HTML' }])
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce([{ id: 'dm-1', name: 'Debit Memo', templateNumber: 'TN-2', templateFormat: 'HTML' }]);

    await makeProgram().parseAsync(['node', 'zdf', 'list', 'billing-templates']);

    expect(output.warn).toHaveBeenCalledWith('Failed to fetch credit-memo templates: Network failure');
    expect(output.info).toHaveBeenCalledWith('invoice          bt-1  Invoice  #TN-1  HTML');
    expect(output.info).toHaveBeenCalledWith('debit-memo       dm-1  Debit Memo  #TN-2  HTML');
    expect(output.success).toHaveBeenCalledWith('Fetched 2 billing templates.');
  });
});

describe('billing-template invalid marker', () => {
  it('push throws a clear error when _zdfTemplateType is present but not a valid value', async () => {
    const fileContent = { ...DESIGN_JSON, _zdfTemplateType: 'unknown-type' };
    mockReaddirSync.mockReturnValue(['Bad_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(fileContent));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'push', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    expect(mockGet).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('Invalid _zdfTemplateType'));
    exitSpy.mockRestore();
  });

  it('delete with invalid marker in local file throws clear error (does not auto-detect)', async () => {
    const fileContent = { ...DESIGN_JSON, _zdfTemplateType: 'bogus' };
    mockReaddirSync.mockReturnValue(['Bad_Template_bt-1.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify(fileContent));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'delete', 'billing-template', 'bt-1'])
    ).rejects.toThrow('exit');
    expect(mockGet).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('Invalid _zdfTemplateType'));
    exitSpy.mockRestore();
  });
});
