import { z } from 'zod';

/** Maximum field lengths, enforced by the API and as `maxlength` in the form. */
export const BOOKMARK_MAX_LENGTH = { name: 40, environment: 100, url: 2048 } as const;

export const bookmarkFormSchema = z.object({
  productId: z.string().max(64),
  name: z.string().trim().min(1).max(BOOKMARK_MAX_LENGTH.name),
  environment: z.string().max(BOOKMARK_MAX_LENGTH.environment),
  url: z.url({ protocol: /^https?$/ }).max(BOOKMARK_MAX_LENGTH.url),
  pinned: z.boolean()
});

export const bookmarkSchema = bookmarkFormSchema.extend({
  id: z.string(),
  createdAt: z.string()
});

export type Bookmark = z.infer<typeof bookmarkSchema>;

/** Hostname of a bookmark URL, or the input unchanged if it does not parse. */
export function bookmarkHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
