import { error, isHttpError } from '@sveltejs/kit';
import type { StorageProvider } from './provider.js';

export function wrapProvider(raw: StorageProvider): StorageProvider {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            const result = value.apply(target, args);
            if (result instanceof Promise) {
              return result.catch((err: unknown) => {
                if (isHttpError(err)) throw err;
                throw error(502, err instanceof Error ? err.message : 'Storage provider error');
              });
            }
            return result;
          } catch (err) {
            if (isHttpError(err)) throw err;
            throw error(502, err instanceof Error ? err.message : 'Storage provider error');
          }
        };
      }
      return value;
    }
  });
}
