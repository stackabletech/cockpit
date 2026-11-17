// Production entry point: starts the adapter-node server (build/index.js) and
// applies the server settings adapter-node does not read from the environment.
//
// REQUEST_TIMEOUT sets Node's http.Server requestTimeout, the time to receive a
// whole request including its body (Node default: 300 s). The storage browser
// uploads each file in a single request, so this caps the upload duration.
// adapter-node only exposes KEEP_ALIVE_TIMEOUT and HEADERS_TIMEOUT.

import http from 'node:http';

/**
 * Parses REQUEST_TIMEOUT (whole seconds, 0 disables the timeout) into
 * milliseconds. Unset or blank leaves Node's default in place.
 *
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
export function parseRequestTimeout(value) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `REQUEST_TIMEOUT must be a non-negative integer number of seconds, got "${trimmed}"`
    );
  }
  return Number(trimmed) * 1000;
}

/**
 * Sets requestTimeout on the server exported by build/index.js. adapter-node 5
 * exports its polka instance (the http.Server is its `server` property),
 * adapter-node 6 the http.Server itself. Throws on any other shape, so an
 * adapter upgrade cannot silently drop the setting.
 *
 * @param {unknown} exported
 * @param {number} timeoutMs
 */
export function applyRequestTimeout(exported, timeoutMs) {
  const server =
    exported instanceof http.Server
      ? exported
      : /** @type {{ server?: unknown } | undefined} */ (exported)?.server;
  if (!(server instanceof http.Server)) {
    throw new Error('build/index.js does not export the http.Server; cannot set REQUEST_TIMEOUT');
  }
  // Read on every connection check, so setting it after listen() takes effect.
  server.requestTimeout = timeoutMs;
  // Node only enforces the request timeout while headersTimeout <= requestTimeout
  // (its constructor rejects anything else), so keep that invariant like the
  // constructor's default of min(60 s, requestTimeout) does.
  if (timeoutMs > 0 && server.headersTimeout > timeoutMs) {
    server.headersTimeout = timeoutMs;
  }
}

if (import.meta.main) {
  // Validate before the server starts listening.
  const timeoutMs = parseRequestTimeout(process.env.REQUEST_TIMEOUT);
  // A variable specifier: build/ only exists after `npm run build`, and type
  // checking must not try to resolve it.
  const entry = new URL('./build/index.js', import.meta.url).href;
  const { server } = await import(entry);
  if (timeoutMs !== undefined) applyRequestTimeout(server, timeoutMs);
}
