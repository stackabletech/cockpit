import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logging';
import { bookmarkFormSchema, type GlobalBookmark } from '$lib/dashboard/types';

const log = logger.child({ module: 'global-bookmarks' });

// Strict, so a misspelt key such as "pined" fails instead of being ignored. An
// unknown productId is accepted and shown as a custom link, as for user bookmarks.
const globalBookmarksSchema = z.array(
  z.strictObject({
    ...bookmarkFormSchema.shape,
    environment: bookmarkFormSchema.shape.environment.default(''),
    pinned: bookmarkFormSchema.shape.pinned.default(false)
  })
);

/**
 * Parse `STACKABLE_COCKPIT_GLOBAL_BOOKMARKS`: a JSON array of bookmarks shown
 * to every user. Throws on invalid JSON or entries; the error names the failing
 * entries and fields but not their values, as URLs can contain credentials.
 */
export function parseGlobalBookmarks(value: string | undefined): GlobalBookmark[] {
  if (!value?.trim()) return [];
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new Error('STACKABLE_COCKPIT_GLOBAL_BOOKMARKS is not valid JSON');
  }
  const parsed = globalBookmarksSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `STACKABLE_COCKPIT_GLOBAL_BOOKMARKS is invalid:\n${z.prettifyError(parsed.error)}`
    );
  }
  return parsed.data.map((bookmark, index) => ({ id: `global-${index}`, ...bookmark }));
}

let cached: GlobalBookmark[] | undefined;

/**
 * The configured global bookmarks. Parsed on first call and cached; called at
 * server start so an invalid configuration stops the server. A function rather
 * than a module-level constant so tests can import this file without the env var.
 */
export function globalBookmarks(): GlobalBookmark[] {
  if (cached) return cached;
  try {
    cached = parseGlobalBookmarks(env.STACKABLE_COCKPIT_GLOBAL_BOOKMARKS);
  } catch (err) {
    log.error({ err }, 'Invalid global bookmarks configuration');
    throw err;
  }
  log.info({ count: cached.length }, 'Loaded global bookmarks');
  return cached;
}
