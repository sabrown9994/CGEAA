import { describe, it, expect, vi } from 'vitest';

const mockSpawnSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawnSync: mockSpawnSync }));

import { runSuitecloud } from '../../helpers/suitecloud.js';

describe('runSuitecloud', () => {
  it('returns status and concatenated stdout/stderr on success', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'success output',
      stderr: '',
    });
    const result = runSuitecloud(['x'], { cwd: '/proj' });
    expect(result).toEqual({ status: 0, output: 'success output' });
  });

  it('surfaces spawnSync launch error (ENOENT when binary not on PATH)', () => {
    mockSpawnSync.mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn suitecloud ENOENT'),
    });
    const result = runSuitecloud(['x'], { cwd: '/proj' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('ENOENT');
  });
});
