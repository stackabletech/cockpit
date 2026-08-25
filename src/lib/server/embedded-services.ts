import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';
import { embeddedServiceRequests } from '$lib/server/metrics.js';

type AuthMode = 'none' | 'all-admins' | 'bearer' | 'sso' | 'simple-users';

interface EmbeddedService {
  id: string;
  upstreamUrl: URL;
  authMode: AuthMode;
  bearerToken?: string;
  /** username -> password, for the "simple-users" auth mode */
  simpleUsers?: Map<string, string>;
}

const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function parseSimpleUsers(raw: string | undefined): Map<string, string> | undefined {
  if (!raw) return undefined;
  const users = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const separator = entry.indexOf(':');
    if (separator <= 0 || separator === entry.length - 1) continue;
    users.set(entry.slice(0, separator).trim().toLowerCase(), entry.slice(separator + 1).trim());
  }
  return users.size > 0 ? users : undefined;
}

/**
 * Every embedded service is configured with flat environment variables derived
 * from its id, e.g. for `airflow`:
 *
 *   STACKABLE_COCKPIT_AIRFLOW_URL       (required — presence enables the service)
 *   STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE "none" (default) | "all-admins" | "bearer" | "sso" | "simple-users"
 *   STACKABLE_COCKPIT_AIRFLOW_BEARER_TOKEN
 *   STACKABLE_COCKPIT_AIRFLOW_SIMPLE_USERS  "user:password,user:password" (for "simple-users")
 */
function getServiceConfig(serviceId: string): {
  url?: string;
  authMode: AuthMode;
  bearerToken?: string;
  simpleUsers?: Map<string, string>;
} | null {
  if (!SERVICE_ID_PATTERN.test(serviceId)) return null;

  // Env var names cannot contain hyphens, so `spark-history` maps to
  // STACKABLE_COCKPIT_SPARK_HISTORY_URL.
  const prefix = `STACKABLE_COCKPIT_${serviceId.replaceAll('-', '_').toUpperCase()}_`;
  const rawAuthMode = env[`${prefix}AUTH_MODE`];
  return {
    url: env[`${prefix}URL`],
    authMode:
      rawAuthMode === 'bearer' ||
      rawAuthMode === 'sso' ||
      rawAuthMode === 'all-admins' ||
      rawAuthMode === 'simple-users'
        ? rawAuthMode
        : 'none',
    bearerToken: env[`${prefix}BEARER_TOKEN`],
    simpleUsers: parseSimpleUsers(env[`${prefix}SIMPLE_USERS`])
  };
}

/** Ids of all embedded services that have an upstream URL configured. */
export function configuredEmbeddedServices(): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(env)) {
    const match = /^STACKABLE_COCKPIT_([A-Z0-9_]+)_URL$/.exec(key);
    if (match) {
      const serviceId = match[1].toLowerCase().replaceAll('_', '-');
      // Skip unrelated cockpit settings that merely share the suffix shape.
      if (SERVICE_ID_PATTERN.test(serviceId)) ids.add(serviceId);
    }
  }
  return [...ids].sort();
}

/** Test seam: drop all cached simple-users tokens. */
export function clearEmbeddedServiceTokenCache(): void {
  simpleUserTokens.clear();
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const RESPONSE_HEADERS_TO_REMOVE = new Set([
  ...HOP_BY_HOP_HEADERS,
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'x-frame-options'
]);

function getService(serviceId: string): EmbeddedService {
  const config = getServiceConfig(serviceId);
  if (!config?.url) {
    throw error(404, 'Embedded service is not configured');
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(config.url);
  } catch {
    throw error(500, 'Embedded service URL is invalid');
  }

  if (!['http:', 'https:'].includes(upstreamUrl.protocol)) {
    throw error(500, 'Embedded service URL must use HTTP or HTTPS');
  }

  if (config.authMode === 'bearer' && !config.bearerToken) {
    throw error(500, 'Embedded service bearer token is not configured');
  }
  if (config.authMode === 'simple-users' && !config.simpleUsers) {
    throw error(
      500,
      `Embedded service simple users are not configured (${`STACKABLE_COCKPIT_${serviceId.replaceAll('-', '_').toUpperCase()}_SIMPLE_USERS`})`
    );
  }

  return {
    id: serviceId,
    upstreamUrl,
    authMode: config.authMode,
    bearerToken: config.bearerToken,
    simpleUsers: config.simpleUsers
  };
}

/**
 * Cached upstream tokens for the "simple-users" auth mode, keyed by
 * `<serviceId>:<username>`. Tokens are refreshed shortly before their JWT
 * `exp` claim.
 */
const simpleUserTokens = new Map<string, { token: string; expiresAtMs: number }>();

function jwtExpiresAtMs(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      exp?: number;
    };
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function fetchSimpleUserToken(service: EmbeddedService, username: string): Promise<string> {
  const cacheKey = `${service.id}:${username}`;
  const cached = simpleUserTokens.get(cacheKey);
  if (cached && cached.expiresAtMs - 60_000 > Date.now()) return cached.token;

  let response: Response;
  try {
    response = await fetch(new URL('/auth/token', service.upstreamUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password: service.simpleUsers!.get(username) })
    });
  } catch {
    throw error(502, 'Could not authenticate with embedded Airflow');
  }
  if (!response.ok) {
    throw error(502, 'Could not authenticate with embedded Airflow');
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw error(502, 'Embedded Airflow did not return an access token');
  }
  simpleUserTokens.set(cacheKey, {
    token: body.access_token,
    expiresAtMs: jwtExpiresAtMs(body.access_token)
  });
  return body.access_token;
}

async function getUpstreamToken(service: EmbeddedService): Promise<string> {
  if (service.authMode === 'bearer') return service.bearerToken!;

  // "all-admins": stock Airflow dev stack — fetch a token from its
  // unauthenticated all-admins token endpoint, server-side only.
  let response: Response;
  try {
    response = await fetch(new URL('/auth/token', service.upstreamUrl), {
      headers: { accept: 'application/json' }
    });
  } catch {
    throw error(502, 'Could not authenticate with embedded Airflow');
  }
  if (!response.ok) {
    throw error(502, 'Could not authenticate with embedded Airflow');
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw error(502, 'Embedded Airflow did not return an access token');
  }
  return body.access_token;
}

async function proxyRequestHeaders(
  event: RequestEvent,
  service: EmbeddedService
): Promise<Headers> {
  const headers = new Headers();
  for (const [name, value] of event.request.headers) {
    if (
      !HOP_BY_HOP_HEADERS.has(name) &&
      // `x-forwarded-*` is always derived server-side below — never forwarded
      // from the browser, where it could be spoofed to impersonate a user.
      !name.startsWith('x-forwarded-') &&
      !['authorization', 'cookie', 'host', 'origin', 'referer'].includes(name)
    ) {
      headers.set(name, value);
    }
  }

  if (service.authMode === 'sso') {
    const user = event.locals.user;
    const username = user?.username ?? user?.name;
    if (!user || !username) {
      event.locals.logger.warn({ service: service.id }, 'No SSO identity in session');
      throw error(401, 'Embedded service requires an authenticated cockpit session');
    }
    // The upstream must run behind an identity-trusting auth layer (e.g. an
    // oauth2-proxy-style middleware) that turns these oauth2-proxy-format
    // headers into a per-user session.
    headers.set('x-forwarded-preferred-username', username);
    if (user.email) headers.set('x-forwarded-email', user.email);
  } else if (service.authMode === 'simple-users') {
    const user = event.locals.user;
    const username = (user?.username ?? user?.name)?.toLowerCase();
    if (!user || !username) {
      event.locals.logger.warn({ service: service.id }, 'No SSO identity in session');
      throw error(401, 'Embedded service requires an authenticated cockpit session');
    }
    if (!service.simpleUsers!.has(username)) {
      event.locals.logger.warn(
        { service: service.id, upstream_user: username },
        'Session user has no embedded-service account'
      );
      throw error(403, `No ${service.id} account is configured for cockpit user "${username}"`);
    }
    // Exchange the dex-sourced session identity for a real per-user Airflow
    // token via stock SimpleAuthManager's /auth/token endpoint.
    const token = await fetchSimpleUserToken(service, username);
    headers.set('authorization', `Bearer ${token}`);
  } else if (service.authMode !== 'none') {
    const token = await getUpstreamToken(service);
    headers.set('authorization', `Bearer ${token}`);
  }

  headers.set('x-forwarded-host', event.url.host);
  headers.set('x-forwarded-proto', event.url.protocol.slice(0, -1));
  return headers;
}

function proxyResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of upstream) {
    if (
      !RESPONSE_HEADERS_TO_REMOVE.has(name) &&
      name !== 'set-cookie' &&
      !['content-encoding', 'content-length'].includes(name)
    ) {
      headers.append(name, value);
    }
  }
  return headers;
}

function rewriteRedirectLocation(
  upstream: Headers,
  service: EmbeddedService,
  serviceId: string
): Headers {
  const headers = proxyResponseHeaders(upstream);
  const location = headers.get('location');
  if (!location) return headers;

  const redirect = new URL(location, service.upstreamUrl);
  if (redirect.origin === service.upstreamUrl.origin) {
    headers.set(
      'location',
      `/api/services/${serviceId}${redirect.pathname}${redirect.search}${redirect.hash}`
    );
  }
  return headers;
}

function stripServicePrefix(pathname: string, serviceId: string): string {
  const prefix = `/api/services/${serviceId}`;
  const path = pathname.slice(prefix.length);
  return path || '/';
}

function rewriteHtml(html: string, service: EmbeddedService, serviceId: string): string {
  const servicePath = `/api/services/${serviceId}/`;
  const ensureTrailingSlash = `<script>if (location.pathname === '${servicePath.slice(0, -1)}') history.replaceState(null, '', '${servicePath}' + location.search + location.hash);</script>`;
  return html
    .replace(/<base\s+href=(['"])[^'"]*\1/i, `<base href="${servicePath}"`)
    .replace('<head>', `<head>${ensureTrailingSlash}`)
    .replaceAll(service.upstreamUrl.href, servicePath);
}

export async function proxyEmbeddedService(
  event: RequestEvent,
  serviceId: string
): Promise<Response> {
  const service = getService(serviceId);
  const path = stripServicePrefix(event.url.pathname, serviceId);
  const upstreamUrl = new URL(path, service.upstreamUrl);
  upstreamUrl.search = event.url.search;

  const method = event.request.method;
  const request: RequestInit & { duplex?: 'half' } = {
    method,
    headers: await proxyRequestHeaders(event, service),
    body: method === 'GET' || method === 'HEAD' ? undefined : event.request.body,
    redirect: 'manual'
  };
  if (request.body) request.duplex = 'half';

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, request);
  } catch (err) {
    event.locals.logger.warn({ err, service: serviceId }, 'Embedded service request failed');
    embeddedServiceRequests.inc({ service: serviceId, outcome: 'error' });
    throw error(502, 'Embedded service is unavailable');
  }
  if (upstream.status === 401 || upstream.status === 403) {
    event.locals.logger.warn(
      { service: serviceId, upstream_status: upstream.status },
      'Embedded service rejected proxy credentials'
    );
  }
  embeddedServiceRequests.inc({ service: serviceId, outcome: upstream.ok ? 'success' : 'error' });
  event.locals.logger.debug(
    { service: serviceId, upstream_status: upstream.status },
    'Embedded service request forwarded'
  );
  const contentType = upstream.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    const html = rewriteHtml(await upstream.text(), service, serviceId);
    return new Response(html, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: proxyResponseHeaders(upstream.headers)
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: rewriteRedirectLocation(upstream.headers, service, serviceId)
  });
}
