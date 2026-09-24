import pino from 'pino';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { redactionPaths, redactionCensor } from './redaction.js';

function createTestLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });

  const log = pino(
    {
      level: 'debug',
      redact: { paths: redactionPaths, censor: redactionCensor }
    },
    stream
  );

  return { log, lines };
}

describe('redaction', () => {
  it('redacts exact token fields', () => {
    const { log, lines } = createTestLogger();
    log.info({ accessToken: 'secret-value', refreshToken: 'secret-value' }, 'test');
    log.flush();

    const parsed = JSON.parse(lines[0]);
    expect(parsed.accessToken).toBe('[Redacted]');
    expect(parsed.refreshToken).toBe('[Redacted]');
  });

  it('redacts snake_case token fields', () => {
    const { log, lines } = createTestLogger();
    log.info({ access_token: 'secret', refresh_token: 'secret', id_token: 'secret' }, 'test');
    log.flush();

    const parsed = JSON.parse(lines[0]);
    expect(parsed.access_token).toBe('[Redacted]');
    expect(parsed.refresh_token).toBe('[Redacted]');
    expect(parsed.id_token).toBe('[Redacted]');
  });

  it('redacts password and secret fields', () => {
    const { log, lines } = createTestLogger();
    log.info({ password: 'pass123', secret: 'sec', client_secret: 'cs' }, 'test');
    log.flush();

    const parsed = JSON.parse(lines[0]);
    expect(parsed.password).toBe('[Redacted]');
    expect(parsed.secret).toBe('[Redacted]');
    expect(parsed.client_secret).toBe('[Redacted]');
  });

  it('redacts nested fields via wildcard paths', () => {
    const { log, lines } = createTestLogger();
    log.info({ nested: { authorization: 'Bearer xxx', password: 'pass' } }, 'test');
    log.flush();

    const parsed = JSON.parse(lines[0]);
    expect(parsed.nested.authorization).toBe('[Redacted]');
    expect(parsed.nested.password).toBe('[Redacted]');
  });

  it('redacts req.headers.authorization', () => {
    const { log, lines } = createTestLogger();
    log.info(
      {
        req: {
          headers: { authorization: 'Bearer secret', cookie: 'session=abc', 'set-cookie': 'x=y' }
        }
      },
      'test'
    );
    log.flush();

    const parsed = JSON.parse(lines[0]);
    expect(parsed.req.headers.authorization).toBe('[Redacted]');
    expect(parsed.req.headers.cookie).toBe('[Redacted]');
    expect(parsed.req.headers['set-cookie']).toBe('[Redacted]');
  });

  it('redacts the storage connection header, which carries the S3 secret key', () => {
    const { log, lines } = createTestLogger();
    const header = btoa(
      JSON.stringify({ type: 's3', credentials: { accessKey: 'AK', secretKey: 'SK-CANARY' } })
    );
    log.info({ req: { headers: { 'x-storage-connection': header } } }, 'test');
    log.flush();

    expect(lines[0]).not.toContain(header);
    expect(JSON.parse(lines[0]).req.headers['x-storage-connection']).toBe('[Redacted]');
  });

  it('redacts the storage connection header on a bare headers object', () => {
    const { log, lines } = createTestLogger();
    const header = btoa(JSON.stringify({ credentials: { secretKey: 'SK-CANARY' } }));
    log.info({ headers: { 'x-storage-connection': header } }, 'test');
    log.flush();

    expect(lines[0]).not.toContain(header);
    expect(JSON.parse(lines[0]).headers['x-storage-connection']).toBe('[Redacted]');
  });

  it('redacts the credential material an S3 endpoint echoes back', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/xml' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><Error>` +
          `<Code>SignatureDoesNotMatch</Code><Message>mismatch</Message>` +
          `<AWSAccessKeyId>AKIA-CANARY</AWSAccessKeyId>` +
          `<StringToSign>STS-CANARY</StringToSign>` +
          `<SignatureProvided>SIG-CANARY</SignatureProvided>` +
          `<CanonicalRequest>CR-CANARY</CanonicalRequest>` +
          `</Error>`
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const client = new S3Client({
      region: 'eu-central-1',
      endpoint: `http://127.0.0.1:${port}`,
      forcePathStyle: true,
      credentials: { accessKeyId: 'AKIA-CANARY', secretAccessKey: 'x' },
      maxAttempts: 1
    });

    const { log, lines } = createTestLogger();
    try {
      await client.send(new ListBucketsCommand({}));
      throw new Error('expected the request to fail');
    } catch (err) {
      log.warn({ err }, 'storage connection test failed');
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    log.flush();

    const line = lines[0];
    expect(line).not.toContain('AKIA-CANARY');
    expect(line).not.toContain('STS-CANARY');
    expect(line).not.toContain('SIG-CANARY');
    expect(line).not.toContain('CR-CANARY');

    // The diagnostics support actually needs must survive.
    const parsed = JSON.parse(line);
    expect(parsed.err.name).toBe('SignatureDoesNotMatch');
    expect(parsed.err.$metadata.httpStatusCode).toBe(403);
  }, 20000);

  it('redacts echoed credentials nested in aggregated errors', () => {
    const { log, lines } = createTestLogger();
    const inner = Object.assign(new Error('inner'), { AWSAccessKeyId: 'AKIA-CANARY' });
    log.warn({ err: new AggregateError([inner], 'all failed') }, 'test');
    log.flush();

    expect(lines[0]).not.toContain('AKIA-CANARY');
  });

  it('does not redact safe fields', () => {
    const { log, lines } = createTestLogger();
    log.info({ user_id: 'u123', path: '/api/test' }, 'test');
    log.flush();

    const parsed = JSON.parse(lines[0]);
    expect(parsed.user_id).toBe('u123');
    expect(parsed.path).toBe('/api/test');
  });
});
