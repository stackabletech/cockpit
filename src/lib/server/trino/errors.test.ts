import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

import { TrinoHttpError, TrinoQueryFailure, classifyTrinoError, toQueryError } from './errors.js';

describe('toQueryError', () => {
  it.each(['USER_ERROR', 'INSUFFICIENT_RESOURCES'])('passes on the message of %s', (errorType) => {
    expect(toQueryError({ message: 'line 1:8: Column x cannot be resolved', errorType })).toEqual({
      kind: 'query',
      message: 'line 1:8: Column x cannot be resolved'
    });
  });

  it.each(['INTERNAL_ERROR', 'EXTERNAL', undefined])(
    'withholds the message of %s and keeps the error name',
    (errorType) => {
      expect(
        toQueryError({
          message: 'Failed connecting to metastore thrift://hive.internal:9083',
          errorName: 'HIVE_METASTORE_ERROR',
          errorType
        })
      ).toEqual({ kind: 'server', name: 'HIVE_METASTORE_ERROR' });
    }
  );

  it.each([undefined, {}, { errorType: 'USER_ERROR' }])(
    'reports a failure without a message as unknown (%o)',
    (trinoError) => {
      expect(toQueryError(trinoError)).toEqual({ kind: 'unknown' });
    }
  );
});

describe('classifyTrinoError', () => {
  it('classifies a Trino query failure by its error type', () => {
    const err = new TrinoQueryFailure({ message: 'Access Denied', errorType: 'USER_ERROR' });
    expect(classifyTrinoError(err)).toEqual({ kind: 'query', message: 'Access Denied' });
  });

  it.each([
    ['an HTTP error', new TrinoHttpError('poll', 502, '<html>proxy.internal</html>')],
    ['a network failure', new TypeError('fetch failed')]
  ])('reports %s as unavailable', (_, err) => {
    expect(classifyTrinoError(err)).toEqual({ kind: 'unavailable' });
  });
});

describe('TrinoHttpError', () => {
  it('keeps the response body out of the message and caps it', () => {
    const err = new TrinoHttpError('poll', 502, 'x'.repeat(5000));
    expect(err.message).toBe('Trino poll failed (502)');
    expect(err.body).toHaveLength(2000);
  });
});
