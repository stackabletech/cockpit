/**
 * Shared helpers for architecture fitness tests.
 *
 * ArchUnitTS only scans TypeScript (.ts) source files. Svelte (.svelte) and
 * JSON files are invisible to its file graph. Rules that need to inspect
 * .svelte file content therefore use plain Node.js fs helpers instead.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Standard options: suppress verbose logs, fail on empty patterns. */
export const defaultOptions = {
  logging: { enabled: false, level: 'warn' as const }
};

/**
 * Recursively collect all files under `dir` whose names match `filenamePattern`.
 * Hidden directories (starting with `.`) are skipped automatically.
 */
export function findFiles(
  dir: string,
  filenamePattern: RegExp,
  excludeDirs: RegExp[] = []
): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (excludeDirs.some((p) => p.test(fullPath))) continue;
      results.push(...findFiles(fullPath, filenamePattern, excludeDirs));
    } else if (entry.isFile() && filenamePattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Check every file returned by `findFiles` against `predicate`.
 * Returns a list of `{ file, reason }` violation objects.
 */
export function checkFiles(
  files: string[],
  predicate: (content: string) => boolean,
  reason: string
): Array<{ file: string; reason: string }> {
  return files
    .filter((file) => {
      const content = readFileSync(file, 'utf-8');
      return !predicate(content);
    })
    .map((file) => ({ file, reason }));
}
