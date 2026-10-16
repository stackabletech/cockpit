/**
 * Generate a RFC 4122 version 4 UUID.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts, so it is
 * `undefined` when the app is served over plain HTTP on a non-`localhost`
 * host. Calling it there throws `TypeError: crypto.randomUUID is not a
 * function`, which breaks any feature that mints an ID on the client.
 *
 * `crypto.getRandomValues()` carries no such restriction, so fall back to
 * assembling the UUID from random bytes there. The fast path is kept because
 * this module is also evaluated during SSR, where Node's `crypto` provides it.
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10x

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-');
}
