import { error } from '@sveltejs/kit';
import { decrypt, fingerprint } from './encryption.js';
import type { StorageConnectionConfig, StorageType } from './types.js';

/** S3 fields stored inside `encrypted_payload`. Rows written before HDFS support have no `type`. */
export interface S3StoredPayload {
  type?: 's3';
  host: string;
  port?: number;
  tls?: { verification: 'Full' | 'None' };
  accessStyle: 'Path' | 'VirtualHosted';
  region: { name: string };
  credentials?: { accessKey: string; secretKey: string };
}

/** HDFS fields stored inside `encrypted_payload`. */
export interface HDFSStoredPayload {
  type: 'hdfs';
  host: string;
  port?: number;
  tls?: { verification: 'Full' | 'None' };
  /** All NameNodes (`host[:port]`) of an HA cluster; `host` is the first. */
  nameNodes?: string[];
  /** Absent for connections saved before Kerberos support: simple auth. */
  auth?: 'simple' | 'kerberos';
  servicePrincipal?: string;
  /** HDFS user for no-OIDC dev mode only; ignored whenever an SSO identity exists. */
  devUser?: string;
}

export type StoredPayload = S3StoredPayload | HDFSStoredPayload;

/** The caller identity a connection is resolved for. */
export interface StorageIdentity {
  userId: string;
  /** SSO username, or `null` when running without OIDC. */
  username: string | null;
}

export function getStorageIdentity(locals: App.Locals): StorageIdentity {
  return {
    userId: locals.user?.id ?? 'anonymous',
    username: locals.user?.username ?? null
  };
}

export function payloadType(payload: StoredPayload): StorageType {
  return payload.type ?? 's3';
}

export function decryptPayload(encryptedPayload: string, key: Buffer): StoredPayload {
  return JSON.parse(decrypt(encryptedPayload, key)) as StoredPayload;
}

/** Display endpoint, e.g. `minio.example.com:9000`; the first NameNode for HDFS. */
export function toEndpoint(payload: StoredPayload): string | null {
  const first = payload.type === 'hdfs' ? payload.nameNodes?.[0] : undefined;
  if (first && /:\d+$/.test(first)) return first;
  const host = first ?? payload.host;
  if (!host) return null;
  return payload.port ? `${host}:${payload.port}` : host;
}

/** Convert a config into the payload persisted in `encrypted_payload`. */
export function toStoredPayload(config: StorageConnectionConfig, devUser?: string): StoredPayload {
  if (config.type === 'hdfs') {
    return {
      type: 'hdfs',
      host: config.host,
      port: config.port,
      tls: config.tls,
      ...(config.nameNodes?.length ? { nameNodes: config.nameNodes } : {}),
      ...(config.auth === 'kerberos' ? { auth: 'kerberos' as const } : {}),
      ...(config.servicePrincipal ? { servicePrincipal: config.servicePrincipal } : {}),
      ...(devUser ? { devUser } : {})
    };
  }
  return {
    type: 's3',
    host: config.host,
    port: config.port,
    tls: config.tls,
    accessStyle: config.accessStyle,
    region: config.region,
    credentials: config.credentials
  };
}

/**
 * Build the runtime connection config from a stored payload. For HDFS the
 * user is the SSO identity; the stored dev-mode user is only used without OIDC.
 */
export function toConnectionConfig(
  payload: StoredPayload,
  additionalBuckets: string[],
  identity: StorageIdentity
): StorageConnectionConfig {
  if (payload.type === 'hdfs') {
    const user = identity.username ?? payload.devUser;
    if (!user) throw error(400, 'No HDFS user available for this connection');
    return {
      type: 'hdfs',
      host: payload.host,
      port: payload.port,
      tls: payload.tls,
      ...(payload.nameNodes?.length ? { nameNodes: payload.nameNodes } : {}),
      auth: payload.auth ?? 'simple',
      ...(payload.servicePrincipal ? { servicePrincipal: payload.servicePrincipal } : {}),
      user,
      additionalBuckets
    };
  }
  return {
    type: 's3',
    host: payload.host,
    port: payload.port,
    tls: payload.tls,
    accessStyle: payload.accessStyle,
    region: payload.region,
    credentials:
      payload.credentials?.accessKey && payload.credentials?.secretKey
        ? payload.credentials
        : undefined,
    additionalBuckets
  };
}

/**
 * Dedup fingerprint. Includes type and port so that e.g. an anonymous S3
 * endpoint and an HDFS NameNode on the same host do not collide.
 */
export function payloadFingerprint(payload: StoredPayload, key: Buffer): string {
  if (payload.type === 'hdfs') {
    const nameNodes = payload.nameNodes?.join(',') ?? payload.host;
    const endpoint = `hdfs://${nameNodes}:${payload.port ?? ''}`;
    const auth = `${payload.auth ?? 'simple'}|${payload.servicePrincipal ?? ''}`;
    return fingerprint(
      { endpoint, region: auth, accessKeyId: payload.devUser ?? '', secretAccessKey: '' },
      key
    );
  }
  return fingerprint(
    {
      endpoint: s3Endpoint(payload),
      region: payload.region.name,
      accessKeyId: payload.credentials?.accessKey || '',
      secretAccessKey: payload.credentials?.secretKey || ''
    },
    key
  );
}

function s3Endpoint(payload: S3StoredPayload): string {
  return `s3://${payload.host}:${payload.port ?? ''}`;
}
