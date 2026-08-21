export interface EnvironmentConfig {
  name: string;
  type: string;
  baseUrl: string;
  isProduction: boolean;
  clientId: string;
  clientSecret: string;
  token?: string;
  tokenExpiresAt?: number;
  /**
   * True when this env was assembled from ZDF_CLIENT_ID/SECRET/BASE_URL (CI mode)
   * rather than read from the config file. In that mode there is no config file to
   * persist a refreshed token to, so `ensureToken` caches the token in memory
   * instead of calling `saveUpdatedEnv` (which would throw "No ZDF configuration
   * found"). Never written to the config file.
   */
  fromEnv?: boolean;
}

export interface ZdfConfig {
  active: string;
  environments: Record<string, EnvironmentConfig>;
}

export interface ZuoraErrorResponse {
  statusCode: number;
  message: string;
  errors: Array<{ code: string; message: string }>;
}
