import { readFileSync } from 'node:fs';
import { Agent, createServer, get, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trustCaCerts } from './ca-certs.js';

// Unlike ca-certs.test.ts, nothing is mocked: trustCaCerts really changes the default trust
// store, which is why this lives in its own file (Vitest isolates test files).

const fixture = (name: string) => fileURLToPath(new URL(`../test-utils/${name}`, import.meta.url));

const TLS_ERROR = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';

describe('trustCaCerts on real TLS connections', () => {
  let server: Server;
  let port: number;
  // Created before trustCaCerts runs, like the shared agent in storage/s3-client.ts.
  const agent = new Agent({ keepAlive: true });

  beforeAll(async () => {
    server = createServer(
      {
        key: readFileSync(fixture('test-server.key')),
        cert: readFileSync(fixture('test-server.crt'))
      },
      (_req, res) => res.end('ok')
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    agent.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  // Each client resolves to the HTTP status or TLS result, or to the TLS error code.

  // OIDC provider (better-auth) and Trino
  const viaFetch = () =>
    fetch(`https://127.0.0.1:${port}/`).then(
      (res) => res.status,
      (err: TypeError) => (err.cause as { code: string }).code
    );

  // S3
  const viaAgent = () =>
    new Promise((resolve) =>
      get(`https://127.0.0.1:${port}/`, { agent }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', (err: NodeJS.ErrnoException) => resolve(err.code))
    );

  // node-postgres
  const viaTlsConnect = () =>
    new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port }, () => {
        resolve(socket.authorized ? 'authorized' : socket.authorizationError);
        socket.destroy();
      }).on('error', (err: NodeJS.ErrnoException) => resolve(err.code));
    });

  it('makes fetch, an existing https.Agent and tls.connect trust the configured CA', async () => {
    expect([await viaFetch(), await viaAgent(), await viaTlsConnect()]).toEqual([
      TLS_ERROR,
      TLS_ERROR,
      TLS_ERROR
    ]);

    trustCaCerts({ STACKABLE_COCKPIT_TLS_CA_CERTS: fixture('test-ca.crt') });

    expect([await viaFetch(), await viaAgent(), await viaTlsConnect()]).toEqual([
      200,
      200,
      'authorized'
    ]);
  });
});
