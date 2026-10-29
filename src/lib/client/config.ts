// Client-accessible configuration: limits and defaults, not feature toggles.
// Read at runtime via SvelteKit's $env/dynamic/public, so all variables must be
// prefixed PUBLIC_. Keep this module free of browser-only code: the server
// loads it too and enforces `maxEditableFileSize`.

import { z } from 'zod';
import { env } from '$env/dynamic/public';
import { envInteger, envList, envOptionalInteger, parseEnv } from '$lib/env-schema.js';

const schema = z
  .object({
    PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES: envList(['25', '50', '100']).pipe(
      z
        .array(z.coerce.number<string>().int().positive())
        .min(1)
        .transform((sizes) => [...new Set(sizes)].sort((a, b) => a - b))
    ),
    PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE: envOptionalInteger,
    PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE: envInteger(5 * 1024 * 1024),
    PUBLIC_STACKABLE_COCKPIT_MAX_RECENT_FILES: envInteger(15),
    PUBLIC_STACKABLE_COCKPIT_UPLOAD_CONCURRENCY: envInteger(3)
  })
  .refine(
    (config) =>
      config.PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE === undefined ||
      config.PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES.includes(
        config.PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE
      ),
    {
      path: ['PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE'],
      message: 'must be one of PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES'
    }
  );

export function parseClientConfig(env: Record<string, string | undefined>) {
  const config = parseEnv(schema, env);
  const allowedPageSizes: readonly number[] = config.PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES;
  return {
    allowedPageSizes,
    defaultPageSize: config.PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE ?? allowedPageSizes[0],
    maxEditableFileSize: config.PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE,
    maxRecentFiles: config.PUBLIC_STACKABLE_COCKPIT_MAX_RECENT_FILES,
    uploadConcurrency: config.PUBLIC_STACKABLE_COCKPIT_UPLOAD_CONCURRENCY
  };
}

const config = parseClientConfig(env);

/** The page sizes available in paginated list views, deduplicated and sorted
 *  ascending. Controlled by `PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES`
 *  (comma-separated positive integers). Default: `25,50,100`. */
export const allowedPageSizes = config.allowedPageSizes;

/** The page size selected when no user preference is stored. Controlled by
 *  `PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE`; must be one of
 *  `allowedPageSizes`. Default: the smallest allowed page size. */
export const defaultPageSize = config.defaultPageSize;

/** Maximum file size (in bytes) that can be edited inline in the text editor.
 *  Larger files show a read-only preview without the save button. Files up to
 *  this size are previewed completely (not truncated to the text preview
 *  limit) so they can be edited. Also enforced by the save endpoint, which
 *  rejects larger saves with HTTP 413.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE`. Default: 5242880 (5 MiB). */
export const maxEditableFileSize = config.maxEditableFileSize;

/** Maximum number of recently visited files and locations kept in localStorage
 *  for the storage browser history.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_MAX_RECENT_FILES`. Default: 15. */
export const maxRecentFiles = config.maxRecentFiles;

/** Maximum number of parallel HTTP requests fired during the upload conflict
 *  check and during the upload itself.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_UPLOAD_CONCURRENCY`. Default: 3. */
export const uploadConcurrency = config.uploadConcurrency;
