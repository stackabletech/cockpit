import { z } from 'zod';

export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof ALLOWED_PAGE_SIZES)[number];

export function isPageSize(n: number): n is PageSize {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n);
}

export const TabIdSchema = z.uuid();

export const ConnectionSchema = z
  .object({
    connectionUrl: z.string().url(),
    authType: z.enum(['none', 'basic']).default('none'),
    authUsername: z.string().default(''),
    authPassword: z.string().default('')
  })
  .superRefine((data, ctx) => {
    if (data.authType === 'basic') {
      if (!data.authUsername) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authUsername'],
          message: 'Username is required for basic authentication'
        });
      }
      if (!data.authPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authPassword'],
          message: 'Password is required for basic authentication'
        });
      }
    }
  });

export type ConnectionMessage = { type: 'success' } | { type: 'error'; message: string };

export const StatementRequestSchema = z.object({
  statements: z.array(z.string().min(1)).min(1),
  tabId: TabIdSchema,
  catalog: z.string().optional(),
  schema: z.string().optional()
});
