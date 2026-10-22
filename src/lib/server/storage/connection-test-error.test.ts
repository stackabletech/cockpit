import { describe, it, expect } from 'vitest';
import { error } from '@sveltejs/kit';
import { connectionTestErrorMessage } from './connection-test-error.js';

function httpError(status: number): unknown {
  try {
    error(status, 'test');
  } catch (err) {
    return err;
  }
}

describe('connectionTestErrorMessage', () => {
  it('maps HTTP errors by status', () => {
    expect(connectionTestErrorMessage(httpError(403))).toBe(
      'Access denied — check your credentials.'
    );
    expect(connectionTestErrorMessage(httpError(404))).toBe(
      'Could not find the storage backend — check the endpoint.'
    );
    expect(connectionTestErrorMessage(httpError(502))).toBe(
      'The storage backend returned an error — check the endpoint and credentials.'
    );
    expect(connectionTestErrorMessage(httpError(500))).toBe(
      'Could not connect — check the endpoint and credentials.'
    );
  });

  it('maps network errors', () => {
    expect(connectionTestErrorMessage(new Error('connect ECONNREFUSED 127.0.0.1:9000'))).toBe(
      'Could not reach the storage backend — check the host and port.'
    );
  });

  it('maps network errors by code when the message is empty', () => {
    // Connecting to localhost tries IPv6 and IPv4; Node reports both in an AggregateError.
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}`), { code: 'ECONNREFUSED' });
    const aggregate = Object.assign(
      new AggregateError([refused('::1:1'), refused('127.0.0.1:1')], ''),
      { code: 'ECONNREFUSED' }
    );
    expect(connectionTestErrorMessage(aggregate)).toBe(
      'Could not reach the storage backend — check the host and port.'
    );

    const inner = new AggregateError([refused('::1:1')], '');
    expect(connectionTestErrorMessage(inner)).toBe(
      'Could not reach the storage backend — check the host and port.'
    );

    const notFound = Object.assign(new Error(''), { code: 'ENOTFOUND' });
    expect(connectionTestErrorMessage(notFound)).toBe(
      'Could not reach the storage backend — check the host and port.'
    );
  });

  it('maps timeouts, TLS protocol errors and nested causes', () => {
    const network = 'Could not reach the storage backend — check the host and port.';
    const timeout = Object.assign(new Error('Connection timed out after 5000 ms'), {
      name: 'TimeoutError'
    });
    expect(connectionTestErrorMessage(timeout)).toBe(network);

    const tls = Object.assign(new Error('write EPROTO 00000000:error:0A00010B:SSL routines'), {
      code: 'EPROTO'
    });
    expect(connectionTestErrorMessage(tls)).toBe(network);

    const wrapped = new Error('fetch failed', {
      cause: Object.assign(new Error(''), { code: 'ECONNREFUSED' })
    });
    expect(connectionTestErrorMessage(wrapped)).toBe(network);
  });

  it('falls back to the generic message', () => {
    expect(connectionTestErrorMessage(new Error('boom'))).toBe(
      'Could not connect — check the endpoint and credentials.'
    );
    expect(connectionTestErrorMessage('not an error')).toBe(
      'Could not connect — check the endpoint and credentials.'
    );
  });
});
