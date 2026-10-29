/**
 * Read the message of an API error response.
 *
 * Every API route answers errors with an `App.Error` body (`{ message }`),
 * produced by SvelteKit's `error()`, `handleError` or the auth guard. Returns
 * `null` when the message is not worth showing, so callers can fall back to a
 * translated message:
 * - the body is empty or not JSON, e.g. a proxy's HTML error page;
 * - a 401: the session expired and the session-expired modal takes over;
 * - an unexpected error: `handleError` only sends a generic English text,
 *   recognisable by its `requestId`.
 */
export async function readErrorMessage(res: Response): Promise<string | null> {
  if (res.status === 401) return null;
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null);
  if (body === null || typeof body !== 'object' || 'requestId' in body) return null;
  return 'message' in body && typeof body.message === 'string' ? body.message : null;
}
