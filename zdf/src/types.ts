export interface EnvironmentConfig {
  name: string;
  type: string;
  baseUrl: string;
  isProduction: boolean;
  clientId: string;
  clientSecret: string;
  token?: string;
  tokenExpiresAt?: number;
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
