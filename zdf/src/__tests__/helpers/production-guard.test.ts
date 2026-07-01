import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrompt = vi.hoisted(() => vi.fn());
vi.mock('inquirer', () => ({ default: { prompt: mockPrompt } }));

import { confirmProduction } from '../../helpers/production-guard.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('confirmProduction', () => {
  it('does nothing for non-production environment', async () => {
    await expect(confirmProduction(false, 'sandbox')).resolves.toBeUndefined();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('throws when user declines production prompt', async () => {
    mockPrompt.mockResolvedValue({ confirmed: false });
    await expect(confirmProduction(true, 'my-prod')).rejects.toThrow('Aborted');
  });

  it('resolves when user confirms production prompt', async () => {
    mockPrompt.mockResolvedValue({ confirmed: true });
    await expect(confirmProduction(true, 'my-prod')).resolves.toBeUndefined();
  });
});
