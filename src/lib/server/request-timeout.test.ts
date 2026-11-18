import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRequestTimeout, parseRequestTimeout } from '../../../server.js';

describe('parseRequestTimeout', () => {
  it('converts seconds to milliseconds', () => {
    expect(parseRequestTimeout('3600')).toBe(3_600_000);
  });

  it('keeps 0, which disables the timeout', () => {
    expect(parseRequestTimeout('0')).toBe(0);
  });

  it('treats unset and blank as the Node default', () => {
    expect(parseRequestTimeout(undefined)).toBeUndefined();
    expect(parseRequestTimeout('  ')).toBeUndefined();
  });

  it.each(['-1', '1.5', '1h', 'abc'])('rejects %s', (value) => {
    expect(() => parseRequestTimeout(value)).toThrow(/REQUEST_TIMEOUT/);
  });
});

describe('applyRequestTimeout', () => {
  let server: http.Server | undefined;
  let socket: net.Socket | undefined;

  afterEach(async () => {
    socket?.destroy();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server!.close(resolve));
    server = socket = undefined;
  });

  it('accepts an http.Server (adapter-node 6)', () => {
    server = http.createServer();
    applyRequestTimeout(server, 3_600_000);
    expect(server.requestTimeout).toBe(3_600_000);
    expect(server.headersTimeout).toBe(60_000);
  });

  it('accepts a polka instance (adapter-node 5)', () => {
    server = http.createServer();
    applyRequestTimeout({ server }, 3_600_000);
    expect(server.requestTimeout).toBe(3_600_000);
  });

  it('throws when no http.Server is exported', () => {
    expect(() => applyRequestTimeout({}, 1000)).toThrow(/REQUEST_TIMEOUT/);
    expect(() => applyRequestTimeout(undefined, 1000)).toThrow(/REQUEST_TIMEOUT/);
  });

  it('lowers headersTimeout to a smaller request timeout', () => {
    server = http.createServer();
    applyRequestTimeout(server, 10_000);
    expect(server.headersTimeout).toBe(10_000);
  });

  it('keeps headersTimeout when the request timeout is disabled', () => {
    server = http.createServer();
    applyRequestTimeout(server, 0);
    expect(server.requestTimeout).toBe(0);
    expect(server.headersTimeout).toBe(60_000);
  });

  /** Sends headers and part of the body, then reports when the server closes the connection. */
  async function stalledRequest(s: http.Server) {
    const { port } = s.address() as net.AddressInfo;
    socket = net.connect(port, '127.0.0.1');
    const started = Date.now();
    const closed = new Promise<{ status: string; elapsedMs: number }>((resolve) => {
      let data = '';
      socket!.on('data', (chunk) => (data += chunk.toString()));
      socket!.on('close', () =>
        resolve({ status: data.split('\r\n')[0], elapsedMs: Date.now() - started })
      );
    });
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\npartial');
    return closed;
  }

  it('raises the timeout of a server that is already listening', async () => {
    // Node's defaults scaled down (300 s request, 60 s headers) with a short check
    // interval, so the test runs in about a second.
    server = http.createServer({
      connectionsCheckingInterval: 20,
      requestTimeout: 300,
      headersTimeout: 100
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    applyRequestTimeout(server, 1000);

    const { status, elapsedMs } = await stalledRequest(server);

    expect(status).toBe('HTTP/1.1 408 Request Timeout');
    expect(elapsedMs).toBeGreaterThanOrEqual(900);
  });
});
