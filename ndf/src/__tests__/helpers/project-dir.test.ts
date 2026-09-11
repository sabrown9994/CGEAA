import { describe, it, expect, vi } from 'vitest';

const mockReadCgeaaConfig = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('../../helpers/config.js', () => ({ readCgeaaConfig: mockReadCgeaaConfig }));
vi.mock('fs', () => ({ existsSync: mockExistsSync }));

import { getProjectDir, getProductionAuthId, NdfConfigError } from '../../helpers/project-dir.js';

describe('getProjectDir', () => {
  it('returns project dir when config key present and suitecloud.config.js exists', () => {
    mockReadCgeaaConfig.mockReturnValue({ netsuite_project_dir: '/foo/NetSuite' });
    mockExistsSync.mockReturnValue(true);
    expect(getProjectDir()).toBe('/foo/NetSuite');
  });

  it('throws NdfConfigError when key is missing', () => {
    mockReadCgeaaConfig.mockReturnValue({});
    expect(() => getProjectDir()).toThrow(NdfConfigError);
    expect(() => getProjectDir()).toThrow("Run 'cgeaa netsuite setup'");
  });

  it('throws NdfConfigError when suitecloud.config.js not found at path', () => {
    mockReadCgeaaConfig.mockReturnValue({ netsuite_project_dir: '/bad/path' });
    mockExistsSync.mockReturnValue(false);
    expect(() => getProjectDir()).toThrow(NdfConfigError);
  });
});

describe('getProductionAuthId', () => {
  it('returns production auth ID from config', () => {
    mockReadCgeaaConfig.mockReturnValue({ netsuite_production_auth_id: 'CG-Prod' });
    expect(getProductionAuthId()).toBe('CG-Prod');
  });

  it('throws NdfConfigError when missing', () => {
    mockReadCgeaaConfig.mockReturnValue({});
    expect(() => getProductionAuthId()).toThrow(NdfConfigError);
  });
});
