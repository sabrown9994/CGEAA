import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLog = vi.hoisted(() => vi.fn());
const mockError = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.spyOn(console, 'log').mockImplementation(mockLog);
vi.spyOn(console, 'error').mockImplementation(mockError);
vi.spyOn(console, 'warn').mockImplementation(mockWarn);

import { output } from '../../helpers/output.js';

describe('output', () => {
  beforeEach(() => { mockLog.mockClear(); mockError.mockClear(); mockWarn.mockClear(); });

  it('success logs green checkmark', () => {
    output.success('done');
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('done'));
  });

  it('error logs red cross to stderr', () => {
    output.error('bad');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('bad'));
  });
});
