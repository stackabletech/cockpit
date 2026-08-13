import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';
import { embeddedServiceRequests } from '$lib/server/metrics.js';

type AuthMode = 'all-admins' | 'bearer';

interface EmbeddedService {
  upstreamUrl: URL;
  authMode: AuthMode;
  bearerToken?: string;
}

function getServiceConfig(serviceId: string): {
  url?: string;
  authMode: AuthMode;
  bearerToken?: string;
} | null {
  if (serviceId !== 'airflow') return null;

  return {
    url: env.STACKABLE_COCKPIT_AIRFLOW_URL,
    authMode: env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE === 'bearer' ? 'bearer' : 'all-admins',
    bearerToken: env.STACKABLE_COCKPIT_AIRFLOW_BEARER_TOKEN
  };
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

  return { upstreamUrl, authMode: config.authMode, bearerToken: config.bearerToken };
}

async function getAirflowToken(service: EmbeddedService): Promise<string> {
  if (service.authMode === 'bearer') return service.bearerToken!;

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

function proxyRequestHeaders(event: RequestEvent, authorization: string): Headers {
  const headers = new Headers();
  for (const [name, value] of event.request.headers) {
    if (
      !HOP_BY_HOP_HEADERS.has(name) &&
      !['authorization', 'cookie', 'host', 'origin', 'referer', 'x-forwarded-for'].includes(name)
    ) {
      headers.set(name, value);
    }
  }
  headers.set('authorization', authorization);
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

  const token = await getAirflowToken(service);
  const method = event.request.method;
  const request: RequestInit & { duplex?: 'half' } = {
    method,
    headers: proxyRequestHeaders(event, `Bearer ${token}`),
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
