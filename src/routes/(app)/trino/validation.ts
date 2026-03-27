import { z } from 'zod';

export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof ALLOWED_PAGE_SIZES)[number];

export function isPageSize(n: number): n is PageSize {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n);
}

export const TabIdSchema = z.uuid();

export const StatementRequestSchema = z.object({
  sql: z.string().min(1),
  tabId: TabIdSchema,
  catalog: z.string().optional(),
  schema: z.string().optional()
});
