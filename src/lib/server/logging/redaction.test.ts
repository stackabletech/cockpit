import pino from 'pino';
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

  it('does not redact safe fields', () => {
    const { log, lines } = createTestLogger();
    log.info({ user_id: 'u123', path: '/api/test' }, 'test');
    log.flush();

    const parsed = JSON.parse(lines[0]);
    expect(parsed.user_id).toBe('u123');
    expect(parsed.path).toBe('/api/test');
  });
});
