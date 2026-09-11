import { describe, it, expect, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockGetCurrentBranch = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('../../helpers/git.js', () => ({ getCurrentBranch: mockGetCurrentBranch }));

import { checkProductionGuard, getActiveAuthId, ProductionGuardError } from '../../helpers/production-guard.js';

describe('getActiveAuthId', () => {
  it('reads defaultAuthId from project.json', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-Prod' }));
    expect(getActiveAuthId('/proj')).toBe('CG-Prod');
  });
});

describe('checkProductionGuard', () => {
  it('does not throw when active auth is not production', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-intQA' }));
    mockGetCurrentBranch.mockReturnValue('feature/x');
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).not.toThrow();
  });

  it('does not throw on main with production auth', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-Prod' }));
    mockGetCurrentBranch.mockReturnValue('main');
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).not.toThrow();
  });

  it('throws ProductionGuardError on feature branch with production auth', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultAuthId: 'CG-Prod' }));
    mockGetCurrentBranch.mockReturnValue('feature/x');
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).toThrow(ProductionGuardError);
    expect(() => checkProductionGuard('/proj', 'CG-Prod')).toThrow('Merge your changes to main first');
  });
});
