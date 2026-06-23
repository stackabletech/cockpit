/** Per-user S3 connection config — no bucket, stored server-side. */
export interface S3ConnectionConfig {
  type: 's3';
  endpoint?: string;
  /** Use path-style addressing (true) or virtual-hosted style (false). Defaults to true. */
  pathStyle?: boolean;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Full S3 config for creating a bucket-scoped provider. */
export interface S3Config extends S3ConnectionConfig {
  bucket: string;
}

export interface HDFSConfig {
  type: 'hdfs';
  nameNode: string;
  port: number;
  user: string;
}

/** Full config for creating a storage provider (always includes bucket/path scope). */
export type StorageConfig = S3Config | HDFSConfig;

/** Per-user connection config stored in memory (no bucket). */
export type StorageConnectionConfig = S3ConnectionConfig | HDFSConfig;

/** Metadata for a saved connection — never includes credentials. */
export interface ConnectionMetadata {
  id: string;
  name: string;
  type: 's3';
  endpoint?: string;
  updatedAt: Date;
}
