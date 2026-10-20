import { describe, it, expect, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockGetCurrentBranch = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('../../helpers/git.js', () => ({ getCurrentBranch: mockGetCurrentBranch }));

import { getActiveAuthId } from '../../helpers/production-guard.js';

describe('getActiveAuthId', () => {
  it('reads defaultAuthId from project.json', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-Prod' }));
    expect(getActiveAuthId('/proj')).toBe('CG-Prod');
  });
});

