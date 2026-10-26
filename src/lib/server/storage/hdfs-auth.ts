import { error } from '@sveltejs/kit';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'hdfs-auth' });

type Params = Record<string, string>;

/** How the WebHDFS client identifies itself and the acting user to NameNodes. */
export interface HdfsAuthenticator {
  readonly kind: 'simple' | 'kerberos';
  /** Query parameters naming the acting user (`user.name` or `doas`). */
  readonly params: Params;
  /** Request headers for a NameNode request. */
  headers(baseUrl: string): Promise<Record<string, string>>;
  /**
   * Inspect a NameNode response. Returns `true` when the request should be
   * sent once more with fresh credentials.
   */
  onResponse(baseUrl: string, response: Response, retried: boolean): boolean;
}

/** Simple auth: the NameNode trusts the `user.name` parameter. */
export function simpleAuth(user: string): HdfsAuthenticator {
  return {
    kind: 'simple',
    params: { 'user.name': user },
    headers: async () => ({}),
    onResponse: () => false
  };
}

/** The subset of the `kerberos` npm package used for SPNEGO. */
export interface KerberosModule {
  initializeClient(
    service: string,
    options?: { principal?: string }
  ): Promise<{ step(challenge: string): Promise<string> }>;
}

export interface KerberosAuthOptions {
  /** Principal the NameNode's HTTP endpoint runs as, e.g. `HTTP/hdfs.ns.svc.cluster.local`. */
  servicePrincipal: string;
  /** User to impersonate via HDFS proxy-user (`doas`). */
  proxyUser: string;
  /** Client principal; defaults to the one in the configured keytab. */
  principal?: string;
  loadKerberos?: () => Promise<KerberosModule>;
}

/** `HTTP/host@REALM` (or `HTTP@host`) → GSSAPI host-based service name `HTTP@host`. */
export function gssServiceName(servicePrincipal: string): string {
  const withoutRealm = servicePrincipal.split('@')[0];
  const [service, host] = servicePrincipal.includes('/')
    ? withoutRealm.split('/')
    : servicePrincipal.split('@');
  if (!service || !host)
    throw error(400, `Invalid Kerberos service principal: ${servicePrincipal}`);
  return `${service}@${host}`;
}

/**
 * Signed `hadoop.auth` cookies issued after SPNEGO, keyed by NameNode and
 * service principal, so that most requests skip the GSS round trip.
 */
const authCookies = new Map<string, { value: string; expiresAt: number }>();

/** Exposed for tests. */
export function clearHdfsAuthCookies(): void {
  authCookies.clear();
}

function parseAuthCookie(setCookie: string | null): { value: string; expiresAt: number } | null {
  const match = setCookie?.match(/hadoop\.auth="?([^";]*)"?/);
  if (!match?.[1]) return null;
  // Token format: u=<user>&p=<principal>&t=kerberos&e=<expiry epoch ms>&s=<signature>
  const expiry = Number(new URLSearchParams(match[1]).get('e'));
  return {
    value: match[1],
    // Renew a minute early; without an expiry, keep it for five minutes.
    expiresAt: Number.isFinite(expiry) && expiry > 0 ? expiry - 60_000 : Date.now() + 300_000
  };
}

const loadKerberosModule = async (): Promise<KerberosModule> =>
  (await import('kerberos')) as unknown as KerberosModule;

/**
 * Kerberos via SPNEGO with cockpit's own credentials (MIT GSSAPI reads them
 * from `KRB5_CLIENT_KTNAME`), acting for the signed-in user via `doas`.
 */
export function kerberosAuth(options: KerberosAuthOptions): HdfsAuthenticator {
  const service = gssServiceName(options.servicePrincipal);
  const loadKerberos = options.loadKerberos ?? loadKerberosModule;
  const cookieKey = (baseUrl: string) => `${baseUrl}|${service}`;

  async function negotiate(): Promise<string> {
    try {
      const kerberos = await loadKerberos();
      const client = await kerberos.initializeClient(
        service,
        options.principal ? { principal: options.principal } : {}
      );
      return await client.step('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ service, err: message }, 'Kerberos SPNEGO token could not be created');
      throw error(502, `Kerberos authentication to HDFS failed: ${message}`);
    }
  }

  return {
    kind: 'kerberos',
    params: { doas: options.proxyUser },

    async headers(baseUrl): Promise<Record<string, string>> {
      const cookie = authCookies.get(cookieKey(baseUrl));
      if (cookie && cookie.expiresAt > Date.now()) {
        return { Cookie: `hadoop.auth="${cookie.value}"` };
      }
      log.debug({ service, namenode: baseUrl }, 'Creating SPNEGO token');
      return { Authorization: `Negotiate ${await negotiate()}` };
    },

    onResponse(baseUrl, response, retried) {
      const key = cookieKey(baseUrl);
      if (response.status === 401) {
        authCookies.delete(key);
        return !retried;
      }
      const cookie = parseAuthCookie(response.headers.get('set-cookie'));
      if (cookie) authCookies.set(key, cookie);
      return false;
    }
  };
}
