// Dashboard settings: configuration, not feature toggles (those are in
// `$lib/server/feature-flags`). Parsed once at module init.

import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { envJson, parseEnv } from '$lib/env-schema.js';
import { logger } from '$lib/server/logging';
import { bookmarkFormSchema, type BookmarkLink } from '$lib/dashboard/types';

const log = logger.child({ module: 'dashboard-config' });

// Strict, so a misspelt key such as "pined" fails instead of being ignored. An
// unknown productId is accepted and shown as a custom link, as for user bookmarks.
const globalBookmarkSchema = z.strictObject({
  ...bookmarkFormSchema.shape,
  environment: bookmarkFormSchema.shape.environment.default(''),
  pinned: bookmarkFormSchema.shape.pinned.default(false)
});

const schema = z.object({
  STACKABLE_COCKPIT_GLOBAL_BOOKMARKS: envJson(z.array(globalBookmarkSchema), [])
});

/**
 * Throws on invalid configuration. The error names the failing entries and
 * fields but not their values, as URLs can contain credentials.
 */
export function parseDashboardConfig(env: Record<string, string | undefined>) {
  const config = parseEnv(schema, env);
  const globalBookmarks: BookmarkLink[] = config.STACKABLE_COCKPIT_GLOBAL_BOOKMARKS.map(
    (bookmark, index) => ({ id: `global-${index}`, ...bookmark })
  );
  return { globalBookmarks };
}

const config = parseDashboardConfig(env);
log.info({ count: config.globalBookmarks.length }, 'Loaded global bookmarks');

/** Bookmarks shown to every user, before their own, on the dashboard and in the
 *  sidebar. Users cannot change them.
 *  Controlled by `STACKABLE_COCKPIT_GLOBAL_BOOKMARKS` (JSON array). Default: none. */
export const globalBookmarks = config.globalBookmarks;
