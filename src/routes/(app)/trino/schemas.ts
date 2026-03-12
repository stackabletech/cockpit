import { z } from 'zod';

export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = 25 | 50 | 100;

export const ConnectionSchema = z.object({
  connectionUrl: z.string().url(),
  authType: z.enum(['none', 'basic']).default('none'),
  authUsername: z.string().default(''),
  authPassword: z.string().default(''),
  impersonation: z.boolean().default(false)
});

export const StatementRequestSchema = z.object({
  sql: z.string().min(1)
});

export type ConnectionMessage = { type: 'success' } | { type: 'error'; message: string };
