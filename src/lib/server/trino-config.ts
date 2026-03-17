export type AuthConfig = { type: 'none' } | { type: 'basic'; username: string; password: string };

export interface ConnectionConfig {
  connectionUrl: string;
  auth: AuthConfig;
  username: string;
  defaultCatalog?: string;
  defaultSchema?: string;
}
