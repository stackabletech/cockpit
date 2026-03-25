import { z } from 'zod';

export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = 25 | 50 | 100;

export const TabIdSchema = z.uuid();

export const StatementRequestSchema = z.object({
  sql: z.string().min(1),
  tabId: TabIdSchema,
  catalog: z.string().optional(),
  schema: z.string().optional()
});
