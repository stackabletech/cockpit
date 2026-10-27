import { z } from 'zod';
import { PRODUCT_IDS } from './product-ids';

/** Maximum field lengths, enforced by the API and as `maxlength` in the form. */
export const BOOKMARK_MAX_LENGTH = { name: 40, environment: 100, url: 2048 } as const;

export const bookmarkFormSchema = z.object({
  productId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(BOOKMARK_MAX_LENGTH.name),
  environment: z.string().trim().max(BOOKMARK_MAX_LENGTH.environment),
  url: z.url({ protocol: /^https?$/ }).max(BOOKMARK_MAX_LENGTH.url),
  pinned: z.boolean()
});

export const bookmarkSchema = bookmarkFormSchema.extend({
  id: z.string(),
  createdAt: z.string()
});

export type Bookmark = z.infer<typeof bookmarkSchema>;

/**
 * Body of a bookmark create request. Stored bookmarks keep any product id, so a
 * product removed later still shows as a custom link; new ones must be known.
 */
export const bookmarkCreateSchema = bookmarkFormSchema.extend({
  productId: z.enum(PRODUCT_IDS)
});

/** Body of a bookmark update: any subset of the create fields, but at least one. */
export const bookmarkUpdateSchema = bookmarkCreateSchema
  .partial()
  .refine((update) => Object.keys(update).length > 0, { message: 'No fields to update' });

export type BookmarkUpdate = z.infer<typeof bookmarkUpdateSchema>;

/** Hostname of a bookmark URL, or the input unchanged if it does not parse. */
export function bookmarkHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
