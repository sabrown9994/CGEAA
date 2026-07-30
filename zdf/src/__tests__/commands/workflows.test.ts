import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete, setDebug: vi.fn() }));

const mockWrite = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/file-io.js', () => ({ writeResourceFile: mockWrite, readResourceFile: mockRead, renameResourceFile: mockRename }));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));
vi.mock('../../helpers/dependency-graph.js', () => ({
  setNoDependency: vi.fn(),
  isNoDependency: vi.fn().mockReturnValue(false),
}));

import { register } from '../../commands/workflows.js';

function makeProgram() {
  const p = new Command();
  p.option('--debug');
  register(p);
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('zdf pull workflow', () => {
  it('writes the file when the body has no success field (valid workflow object)', async () => {
    mockGet.mockResolvedValue({ id: 123, name: 'My Workflow' });
    await makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '123']);
    expect(mockWrite).toHaveBeenCalledWith('workflow', '123', expect.objectContaining({ id: 123 }));
  });

  it('does not write and exits non-zero when Zuora returns 200-with-reasons', async () => {
    mockGet.mockResolvedValue({
      success: false,
      reasons: [{ code: 58230015, message: 'Object not found.' }],
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(
      makeProgram().parseAsync(['node', 'zdf', 'pull', 'workflow', '999'])
    ).rejects.toThrow('exit');
    expect(mockWrite).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
