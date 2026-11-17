import { error, isHttpError } from '@sveltejs/kit';
import type { StorageProvider } from './provider.js';

/**
 * Whether `err` is adapter-node's rejection of a request body above
 * `BODY_SIZE_LIMIT`. It surfaces when a provider reads the request body, as a
 * `SvelteKitError` with status 413; that class is internal to SvelteKit, so
 * only its status is checked.
 */
function isPayloadTooLarge(err: unknown): err is Error {
  return err instanceof Error && 'status' in err && err.status === 413;
}

/** Rethrows `err` as a SvelteKit HTTP error; anything unrecognised becomes 502. */
function throwHttpError(err: unknown): never {
  if (isHttpError(err)) throw err;
  if (isPayloadTooLarge(err)) error(413, err.message);
  error(502, err instanceof Error ? err.message : 'Storage provider error');
}

/** Maps provider failures to consistent HTTP responses for request handlers. */
export function withStorageHttpErrors(raw: StorageProvider): StorageProvider {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            const result = value.apply(target, args);
            if (result instanceof Promise) {
              return result.catch(throwHttpError);
            }
            return result;
          } catch (err) {
            throwHttpError(err);
          }
        };
      }
      return value;
    }
  });
}
