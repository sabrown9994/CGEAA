import { describe, it, expect, vi } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));

import { getMergeBase, getChangedFiles, getCurrentBranch } from '../../helpers/git.js';

describe('getMergeBase', () => {
  it('returns trimmed SHA from git merge-base', () => {
    mockExecSync.mockReturnValue(Buffer.from('abc123\n'));
    const result = getMergeBase('/proj');
    expect(mockExecSync).toHaveBeenCalledWith('git merge-base main HEAD', {
      cwd: '/proj',
    });
    expect(result).toBe('abc123');
  });
});

describe('getChangedFiles', () => {
  it('categorises SuiteScripts as scripts and Objects as objects', () => {
    mockExecSync.mockReturnValue(
      Buffer.from(
        'src/FileCabinet/SuiteScripts/foo.js\nsrc/Objects/customscript_bar.xml\nREADME.md\n',
      ),
    );
    const result = getChangedFiles('/proj', 'abc123');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff abc123..HEAD --name-only --relative',
      { cwd: '/proj' },
    );
    expect(result.scripts).toEqual(['src/FileCabinet/SuiteScripts/foo.js']);
    expect(result.objects).toEqual(['src/Objects/customscript_bar.xml']);
  });

  it('returns empty arrays when no relevant files changed', () => {
    mockExecSync.mockReturnValue(Buffer.from('README.md\npackage.json\n'));
    const result = getChangedFiles('/proj', 'abc123');
    expect(result.scripts).toEqual([]);
    expect(result.objects).toEqual([]);
  });

  it('excludes deleted files that no longer exist (node_modules, .attributes)', () => {
    mockExecSync.mockReturnValue(
      Buffer.from(
        'src/FileCabinet/SuiteScripts/.attributes\nsrc/FileCabinet/SuiteScripts/real.js\n',
      ),
    );
    const result = getChangedFiles('/proj', 'abc123');
    expect(result.scripts).toEqual(['src/FileCabinet/SuiteScripts/real.js']);
  });
});

describe('getCurrentBranch', () => {
  it('returns current branch name', () => {
    mockExecSync.mockReturnValue(Buffer.from('feature/my-branch\n'));
    expect(getCurrentBranch('/proj')).toBe('feature/my-branch');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --abbrev-ref HEAD',
      { cwd: '/proj' },
    );
  });
});
