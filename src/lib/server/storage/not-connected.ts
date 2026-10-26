import { error } from '@sveltejs/kit';

/**
 * Reject a storage request that has no usable storage connection. A 409 with
 * `reason: 'not-connected'` keeps it apart from a 401, which means the session
 * expired and makes the client check the session.
 */
export function notConnected(message = 'No storage connection configured'): never {
  error(409, { message, reason: 'not-connected' });
}
