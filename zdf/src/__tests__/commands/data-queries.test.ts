import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiDelete: mockDelete, apiQuery: mockQuery, setDebug: vi.fn(), setMaxRows: vi.fn(), APIQUERY_MAX_ROWS: 5000 }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename, resolveFilePath: vi.fn((r: string, id: string) => `MOCK_OUTPUT/${r}/${id}.json`), getOutputDir: vi.fn(() => 'MOCK_OUTPUT') }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

vi.mock('ora', () => ({ default: () => ({ start: () => ({ stop: vi.fn(), fail: vi.fn() }) }) }));

import { register } from '../../commands/data-queries.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('zdf pull data-query', () => {
  it('fetches job status and writes JSON file', async () => {
    mockGet.mockResolvedValue({ id: 'job-123', queryStatus: 'completed', data: [] });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'data-query', 'job-123']);
    expect(mockGet).toHaveBeenCalledWith('/query/jobs/job-123');
    expect(mockWrite).toHaveBeenCalledWith('data-query', 'job-123', { id: 'job-123', queryStatus: 'completed', data: [] });
  });

  it('throws and writes nothing when the response is a 200-with-error body (bad job id)', async () => {
    mockGet.mockResolvedValue({ success: false, reasons: [{ code: 50000040, message: 'Invalid job id' }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeProgram().parseAsync(['node', 'zdf', 'pull', 'data-query', 'bad-id'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('zdf create data-query', () => {
  it('reads .sql file, submits job, polls, writes results JSON', async () => {
    vi.useFakeTimers();
    mockRead.mockReturnValue('SELECT id FROM Account');
    // Data Query wraps submit + poll responses under `data` (matches the live intQA shape).
    mockPost.mockResolvedValue({ data: { id: 'job-new' } });
    mockGet
      .mockResolvedValueOnce({ data: { id: 'job-new', queryStatus: 'in_progress' } })
      .mockResolvedValueOnce({ data: { id: 'job-new', queryStatus: 'completed', dataFile: 'https://zuora.example/result.jsonl', outputRows: 1 } });

    const parsePromise = makeProgram().parseAsync(['node', 'zdf', 'create', 'data-query', 'my-query']);
    await vi.runAllTimersAsync();
    await parsePromise;

    expect(mockRead).toHaveBeenCalledWith('data-query', 'my-query', 'sql');
    // The live-verified Data Query job-creation body (intQA 2026-11-16): query, outputFormat,
    // compression, retries, and a required output.target ('s3' = Zuora's managed result store).
    // Omitting output or retries 400s "Unable to process JSON".
    const [, body] = mockPost.mock.calls[0];
    expect(body).toEqual({
      query: 'SELECT id FROM Account',
      outputFormat: 'JSON',
      compression: 'NONE',
      retries: 3,
      output: { target: 's3' },
    });
    expect(mockWrite).toHaveBeenCalledWith('data-query', 'job-new', expect.objectContaining({ queryStatus: 'completed', dataFile: 'https://zuora.example/result.jsonl' }));
    expect(mockRename).not.toHaveBeenCalled();
  });
});

describe('zdf delete data-query', () => {
  it('cancels the job', async () => {
    mockDelete.mockResolvedValue({ success: true });
    await makeProgram().parseAsync(['node', 'zdf', 'delete', 'data-query', 'job-123']);
    expect(mockDelete).toHaveBeenCalledWith('/query/jobs/job-123');
  });
});
