import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrompt = vi.hoisted(() => vi.fn());
vi.mock('inquirer', () => ({ default: { prompt: mockPrompt } }));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/output.js', () => ({
  output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: mockWarn },
}));

import { confirmProduction } from '../../helpers/production-guard.js';

let originalIsTTY: boolean | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalIsTTY = process.stdin.isTTY;
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('confirmProduction', () => {
  it('assumeYes: true resolves without prompting and warns', async () => {
    await expect(confirmProduction('my-prod', { assumeYes: true })).resolves.toBeUndefined();
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toMatch(/PRODUCTION/);
  });

  it('non-TTY + assumeYes: false throws without prompting', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await expect(confirmProduction('my-prod', { assumeYes: false })).rejects.toThrow(/--yes|ZDF_ASSUME_YES/);
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('TTY + confirmed resolves', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockPrompt.mockResolvedValue({ confirmed: true });
    await expect(confirmProduction('my-prod', { assumeYes: false })).resolves.toBeUndefined();
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('TTY + declined throws "Aborted by user."', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockPrompt.mockResolvedValue({ confirmed: false });
    await expect(confirmProduction('my-prod', { assumeYes: false })).rejects.toThrow('Aborted by user.');
  });
});
