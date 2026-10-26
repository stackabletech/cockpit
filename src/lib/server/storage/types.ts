/** Per-user S3 connection config — no bucket, stored server-side. */
export interface S3ConnectionConfig {
  type: 's3';
  host: string;
  port?: number;
  tls?: { verification: 'Full' | 'None' };
  accessStyle: 'Path' | 'VirtualHosted';
  region: { name: string };
  credentials?: { accessKey: string; secretKey: string };
  additionalBuckets?: string[];
}

/** Full S3 config for creating a bucket-scoped provider. */
export interface S3Config extends S3ConnectionConfig {
  bucket: string;
}

/**
 * Per-user HDFS connection config, talking WebHDFS (or HttpFS) over HTTP(S).
 * `user` is never stored: it is resolved per request from the SSO identity,
 * or from the stored dev-mode user when running without OIDC.
 */
export interface HDFSConnectionConfig {
  type: 'hdfs';
  host: string;
  port?: number;
  tls?: { verification: 'Full' | 'None' };
  /** User to act as: `user.name` with simple auth, the impersonated user (`doas`) with Kerberos. */
  user: string;
  /** Defaults to `simple`. */
  auth?: 'simple' | 'kerberos';
  /** SPNEGO service principal for Kerberos, e.g. `HTTP/hdfs.ns.svc.cluster.local`; defaults to `HTTP/<namenode host>`. */
  servicePrincipal?: string;
  /**
   * All NameNodes as `host[:port]` (port defaults to `port`), for HA failover.
   * When absent, `host` is the only NameNode.
   */
  nameNodes?: string[];
  /** Base paths offered as containers in addition to `/`. */
  additionalBuckets?: string[];
}

/** Full HDFS config for creating a provider scoped to one base path. */
export interface HDFSConfig extends HDFSConnectionConfig {
  /** Absolute HDFS base path, e.g. `/` or `/user/alice`. */
  bucket: string;
}

export type StorageType = 's3' | 'hdfs';

/** Full config for creating a storage provider (always includes bucket/path scope). */
export type StorageConfig = S3Config | HDFSConfig;

/** Per-user connection config (no bucket). */
export type StorageConnectionConfig = S3ConnectionConfig | HDFSConnectionConfig;

/** Minimal connection metadata returned to the client. */
export interface ConnectionMetadata {
  id: string;
  name: string;
  type: StorageType;
  endpoint: string | null;
}
