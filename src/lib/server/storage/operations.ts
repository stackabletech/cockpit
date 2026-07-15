import type { StorageProvider } from './provider.js';

export interface DestEntry {
  sourceKey: string;
  baseDestKey: string;
}

/**
 * Compute copy/move destinations for each source key, expanding directories
 * to their full recursive listing while preserving the relative path
 * structure under the destination prefix.
 */
export async function computeDestinations(
  provider: StorageProvider,
  sourceKeys: string[],
  destinationPrefix: string
): Promise<DestEntry[]> {
  const destinations: DestEntry[] = [];

  for (const key of sourceKeys) {
    const name = key.endsWith('/')
      ? key.split('/').filter(Boolean).pop() + '/'
      : key.split('/').pop();

    if (!key.endsWith('/')) {
      destinations.push({ sourceKey: key, baseDestKey: destinationPrefix + name });
    } else {
      const children = await provider.listAllKeys(key);
      destinations.push({ sourceKey: key, baseDestKey: destinationPrefix + name });
      for (const child of children) {
        if (child === key) continue;
        const relPath = child.slice(key.length);
        destinations.push({ sourceKey: child, baseDestKey: destinationPrefix + name + relPath });
      }
    }
  }

  return destinations;
}

/**
 * Given a desired destination key, check if it already exists and generate
 * a unique name by appending ` (1)`, ` (2)`, etc. before the extension.
 * Returns the first key that does not exist.
 */
export async function uniqueDestKey(provider: StorageProvider, baseKey: string): Promise<string> {
  if (!(await provider.exists(baseKey))) return baseKey;

  const name = baseKey.endsWith('/') ? baseKey.slice(0, -1) : baseKey;
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 && !baseKey.endsWith('/') ? name.slice(lastDot) : '';
  const suffix = baseKey.endsWith('/') ? '/' : '';

  let counter = 1;
  while (true) {
    const candidate = `${stem} (${counter})${ext}${suffix}`;
    if (!(await provider.exists(candidate))) return candidate;
    counter++;
  }
}

/**
 * Encode a value as a single NDJSON line (newline-delimited JSON).
 */
export function ndjsonLine(data: Record<string, unknown>): string {
  return JSON.stringify(data) + '\n';
}
