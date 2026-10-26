/**
 * Read the message of an API error response.
 *
 * Every API route answers errors with an `App.Error` body (`{ message }`),
 * produced by SvelteKit's `error()`, `handleError` or the auth guard. Returns
 * `null` when the body is empty or not JSON, e.g. a proxy's HTML error page,
 * so callers can fall back to a translated message.
 */
export async function readErrorMessage(res: Response): Promise<string | null> {
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null);
  return body !== null &&
    typeof body === 'object' &&
    'message' in body &&
    typeof body.message === 'string'
    ? body.message
    : null;
}
