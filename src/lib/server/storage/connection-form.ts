import { isHttpError } from '@sveltejs/kit';
import type { z } from 'zod';
import type { StorageConnectionSchema } from '$lib/storage/schemas.js';
import { hdfsKerberosAvailable, storageHdfsEnabled } from '$lib/server/feature-flags.js';
import type { StorageConnectionConfig } from './types.js';
import { getStorageIdentity } from './connection-payload.js';
import * as m from '$lib/paraglide/messages.js';

type ConnectionFormData = z.infer<typeof StorageConnectionSchema>;

export type BuiltConnection =
  | { ok: true; config: StorageConnectionConfig; devUser?: string }
  | { ok: false; message: string };

/**
 * Build a connection config from validated form data. For HDFS the user is
 * the SSO username; the form's `devUser` is only honoured without OIDC.
 */
export function buildConnectionConfig(
  data: ConnectionFormData,
  locals: App.Locals
): BuiltConnection {
  const { type, host, port, tls } = data;

  if (type === 'hdfs') {
    if (!storageHdfsEnabled) return { ok: false, message: m.storage_connect_error_hdfs_disabled() };
    const nameNodes = parseNameNodes(host);
    if (!nameNodes) return { ok: false, message: m.storage_connect_error_hdfs_hosts_invalid() };
    const kerberos = data.auth === 'kerberos';
    if (kerberos && !hdfsKerberosAvailable) {
      return { ok: false, message: m.storage_connect_error_hdfs_kerberos_unavailable() };
    }
    const servicePrincipal = kerberos ? data.servicePrincipal || undefined : undefined;
    if (servicePrincipal && !isServicePrincipal(servicePrincipal)) {
      return { ok: false, message: m.storage_connect_error_hdfs_service_principal_invalid() };
    }
    const { username } = getStorageIdentity(locals);
    const devUser = username ? undefined : data.devUser || undefined;
    const user = username ?? devUser;
    if (!user) return { ok: false, message: m.storage_connect_error_hdfs_user_required() };
    return {
      ok: true,
      config: {
        type: 'hdfs',
        host: nameNodes[0].replace(/:\d+$/, ''),
        port,
        tls,
        nameNodes,
        ...(kerberos ? { auth: 'kerberos' as const } : {}),
        ...(servicePrincipal ? { servicePrincipal } : {}),
        user
      },
      devUser
    };
  }

  const { accessStyle, region, credentials } = data;
  return {
    ok: true,
    config: {
      type: 's3',
      host,
      port,
      tls,
      accessStyle,
      region,
      credentials: credentials.accessKey && credentials.secretKey ? credentials : undefined
    }
  };
}

/**
 * Parse a comma-separated NameNode list (`host[:port]`, optional `http(s)://`)
 * into `host[:port]` entries. Returns `null` if any entry is malformed.
 */
export function parseNameNodes(input: string): string[] | null {
  const entries = input
    .split(',')
    .map((entry) =>
      entry
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, '')
    )
    .filter(Boolean);
  if (entries.length === 0) return null;
  const valid = entries.every((entry) => {
    const [host, port, ...rest] = entry.split(':');
    return (
      rest.length === 0 &&
      /^[A-Za-z0-9.-]+$/.test(host) &&
      (port === undefined || /^\d{1,5}$/.test(port))
    );
  });
  return valid ? [...new Set(entries)] : null;
}

/** `service/host` with an optional `@REALM`, e.g. `HTTP/hdfs.default.svc.cluster.local`. */
function isServicePrincipal(value: string): boolean {
  const [name, realm, ...rest] = value.split('@');
  if (rest.length > 0 || (realm !== undefined && !/^[A-Za-z0-9.-]+$/.test(realm))) return false;
  const [service, host, ...more] = name.split('/');
  return (
    more.length === 0 && /^[A-Za-z0-9_-]+$/.test(service) && /^[A-Za-z0-9.-]+$/.test(host ?? '')
  );
}

/** Map a failed connectivity check to a user-facing message. */
export function connectionErrorMessage(err: unknown): string {
  if (isHttpError(err)) {
    if (err.status === 403) return m.storage_connect_error_access_denied();
    if (err.status === 404) return m.storage_connect_error_not_found();
    if (err.status === 502) return m.storage_connect_error_server_error();
    return m.storage_connect_error();
  }
  if (err instanceof Error) {
    const e = (err.message ?? '').toLowerCase();
    if (/econnrefused|enotfound|eai_again|etimedout|network/.test(e)) {
      return m.storage_connect_error_network();
    }
  }
  return m.storage_connect_error();
}
