import { z } from 'zod';

export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = 25 | 50 | 100;

export const QuerySchema = z.object({
  sql: z.string().min(1),
  pageSize: z.coerce.number().default(25),
  connectionUrl: z.string().url(),
  authType: z.enum(['none', 'basic']).default('none'),
  authUsername: z.string().default(''),
  authPassword: z.string().default(''),
  defaultCatalog: z.string().default(''),
  defaultSchema: z.string().default(''),
  impersonation: z.boolean().default(false)
});

export const PaginateSchema = z.object({
  queryId: z.string().min(1),
  page: z.coerce.number().int().nonnegative().default(0),
  pageSize: z.coerce.number().default(25)
});

export type FormMessage =
  | {
      type: 'result';
      queryId: string;
      columns: { name: string; type: string }[];
      rows: unknown[][];
      hasMore: boolean;
      totalRows: number;
    }
  | { type: 'error'; message: string };
