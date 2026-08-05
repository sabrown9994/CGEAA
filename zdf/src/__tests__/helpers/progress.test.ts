import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStart = vi.hoisted(() => vi.fn());
const mockStop = vi.hoisted(() => vi.fn());
const mockOraInstance = vi.hoisted(() => ({ text: '', start: mockStart, stop: mockStop }));
const mockOra = vi.hoisted(() => vi.fn(() => mockOraInstance));
vi.mock('ora', () => ({ default: mockOra }));

import { startProgress, updateProgress, stopProgress } from '../../helpers/progress.js';

const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  vi.clearAllMocks();
  mockStart.mockReturnValue(mockOraInstance);
  stopProgress(); // reset module-level spinner state between tests
});

afterEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  delete process.env['ZDF_NO_PROGRESS'];
});

describe('progress helper — non-TTY (piped/CI/test) mode', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  it('startProgress is a no-op: never constructs or starts an ora spinner', () => {
    startProgress('Fetching page 1…');
    expect(mockOra).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('updateProgress is a no-op with no active spinner', () => {
    startProgress('Fetching page 1…');
    updateProgress('Fetching page 2…');
    expect(mockOra).not.toHaveBeenCalled();
  });

  it('stopProgress is safe to call even though nothing was started', () => {
    expect(() => stopProgress()).not.toThrow();
    expect(mockStop).not.toHaveBeenCalled();
  });
});

describe('progress helper — TTY mode', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  it('startProgress constructs and starts an ora spinner', () => {
    startProgress('Fetching page 1…');
    expect(mockOra).toHaveBeenCalledWith('Fetching page 1…');
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('updateProgress updates the existing spinner text without creating a new one', () => {
    startProgress('Fetching page 1…');
    updateProgress('Fetching page 2…');
    expect(mockOra).toHaveBeenCalledTimes(1);
    expect(mockOraInstance.text).toBe('Fetching page 2…');
  });

  it('stopProgress stops the active spinner and clears it so the next startProgress creates a fresh one', () => {
    startProgress('Fetching page 1…');
    mockStop.mockClear();
    stopProgress();
    expect(mockStop).toHaveBeenCalledTimes(1);
    startProgress('Fetching page 1 again…');
    expect(mockOra).toHaveBeenCalledTimes(2);
  });
});

describe('progress helper — ZDF_NO_PROGRESS override', () => {
  it('is a no-op even on a TTY when ZDF_NO_PROGRESS=1', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env['ZDF_NO_PROGRESS'] = '1';
    startProgress('Fetching page 1…');
    expect(mockOra).not.toHaveBeenCalled();
  });
});
