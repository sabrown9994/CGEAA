import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
