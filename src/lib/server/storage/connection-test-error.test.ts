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

  it('falls back to the generic message', () => {
    expect(connectionTestErrorMessage(new Error('boom'))).toBe(
      'Could not connect — check the endpoint and credentials.'
    );
    expect(connectionTestErrorMessage('not an error')).toBe(
      'Could not connect — check the endpoint and credentials.'
    );
  });
});
