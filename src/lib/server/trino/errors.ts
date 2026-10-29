import { logger } from '$lib/server/logging';
import type { QueryError } from '$lib/types/query.js';

const log = logger.child({ module: 'trino-errors' });

/** Error object of a failed Trino query (only fields we read). */
export interface TrinoQueryError {
  message?: string;
  errorCode?: number;
  errorName?: string;
  errorType?: string;
}

/** Response bodies are kept for logging only; cap them so a proxy's HTML page cannot flood the logs. */
const MAX_LOGGED_BODY_LENGTH = 2000;

/** Trino answered with a non-2xx HTTP status. The body never reaches the client. */
export class TrinoHttpError extends Error {
  readonly body: string;

  constructor(
    operation: string,
    readonly status: number,
    body: string
  ) {
    super(`Trino ${operation} failed (${status})`);
    this.name = 'TrinoHttpError';
    this.body = body.slice(0, MAX_LOGGED_BODY_LENGTH);
  }
}

/** Trino reported a failed query. */
export class TrinoQueryFailure extends Error {
  constructor(readonly trinoError: TrinoQueryError) {
    super(trinoError.message ?? 'Query failed');
    this.name = 'TrinoQueryFailure';
  }
}

/**
 * Error types whose message describes the user's own query. Trino runs the
 * query as the user, so these only mention objects the user may access.
 * INTERNAL_ERROR and EXTERNAL messages can contain exception text, hostnames
 * or storage paths.
 */
const USER_FACING_ERROR_TYPES = new Set(['USER_ERROR', 'INSUFFICIENT_RESOURCES']);

/**
 * Classify the error object of a failed Trino query. Server errors are logged,
 * as their message is withheld from the user.
 */
export function toQueryError(
  trinoError: TrinoQueryError | undefined,
  trinoQueryId?: string
): QueryError {
  if (!trinoError?.message) return { kind: 'unknown' };
  if (USER_FACING_ERROR_TYPES.has(trinoError.errorType ?? '')) {
    return { kind: 'query', message: trinoError.message };
  }
  log.warn(
    {
      trino_query_id: trinoQueryId,
      trino_error_type: trinoError.errorType,
      trino_error_name: trinoError.errorName,
      trino_error_message: trinoError.message
    },
    'Trino reported a server error'
  );
  return { kind: 'server', name: trinoError.errorName ?? null };
}

/** Classify an error thrown while talking to Trino. */
export function classifyTrinoError(err: unknown): QueryError {
  if (err instanceof TrinoQueryFailure) return toQueryError(err.trinoError);
  // HTTP errors, network failures and unparsable responses.
  return { kind: 'unavailable' };
}

/**
 * Error body for an API response after a failed Trino call. Only errors in the
 * user's query keep their message; others get a generic text with the request ID,
 * so the client shows its translated fallback.
 */
export function trinoErrorBody(err: unknown, requestId: string): App.Error {
  const queryError = classifyTrinoError(err);
  if (queryError.kind === 'query') return { message: queryError.message };
  return { message: 'Trino request failed', requestId };
}
