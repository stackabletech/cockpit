import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  loadFromStorage,
  persistToStorage,
  readStorage,
  readStorageJson,
  removeStorage,
  writeStorage
} from './local-storage';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installStorage(getter: () => Storage) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: getter });
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value)
  };
}

// The helpers only touch storage in a browser, which they detect by `window`.
beforeEach(() => {
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('with working storage', () => {
  beforeEach(() => {
    const storage = memoryStorage();
    installStorage(() => storage);
  });

  it('round-trips values', () => {
    expect(writeStorage('k', 'v')).toBe(true);
    expect(readStorage('k')).toBe('v');
    removeStorage('k');
    expect(readStorage('k')).toBeNull();
  });

  it('returns validated JSON and null for corrupt or mismatching data', () => {
    const schema = z.object({ a: z.number() });
    writeStorage('ok', '{"a":1}');
    writeStorage('corrupt', '{');
    writeStorage('old-shape', '{"a":"1"}');
    expect(readStorageJson('ok', schema)).toEqual({ a: 1 });
    expect(readStorageJson('corrupt', schema)).toBeNull();
    expect(readStorageJson('old-shape', schema)).toBeNull();
    expect(readStorageJson('missing', schema)).toBeNull();
  });

  it('drops array entries that do not match the schema', () => {
    persistToStorage('list', [1, 'two', 3]);
    expect(loadFromStorage('list', z.number())).toEqual([1, 3]);
  });
});

describe('when the browser blocks site data', () => {
  // Browsers throw a SecurityError on merely reading the `localStorage` global.
  beforeEach(() => {
    installStorage(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
  });

  it('fails silently', () => {
    expect(readStorage('k')).toBeNull();
    expect(readStorageJson('k', z.unknown())).toBeNull();
    expect(writeStorage('k', 'v')).toBe(false);
    expect(() => removeStorage('k')).not.toThrow();
    expect(loadFromStorage('k', z.number())).toEqual([]);
    expect(() => persistToStorage('k', [1])).not.toThrow();
  });
});

describe('when storage is full', () => {
  beforeEach(() => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    installStorage(() => storage);
  });

  it('reports the failed write', () => {
    expect(writeStorage('k', 'v')).toBe(false);
  });
});
