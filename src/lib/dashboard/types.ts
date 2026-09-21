import { z } from 'zod';

export const bookmarkFormSchema = z.object({
  productId: z.string(),
  name: z.string().trim().min(1),
  environment: z.string(),
  url: z.httpUrl(),
  pinned: z.boolean(),
  pinnedForEveryone: z.boolean()
});

export const bookmarkSchema = bookmarkFormSchema.extend({
  id: z.string(),
  createdAt: z.string()
});

export type Bookmark = z.infer<typeof bookmarkSchema>;
