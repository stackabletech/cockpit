import { z } from 'zod';
import * as m from '$lib/paraglide/messages.js';

export { isPageSize, type PageSize } from '$lib/types/pagination.js';

export const TabIdSchema = z.uuid();

export const ConnectionSchema = z
  .object({
    connectionUrl: z.url({ error: () => m.trino_connection_url_invalid() }),
    authType: z.enum(['none', 'basic']).default('none'),
    authUsername: z.string().default(''),
    authPassword: z.string().default('')
  })
  .superRefine((data, ctx) => {
    if (data.authType === 'basic') {
      if (!data.authUsername) {
        ctx.addIssue({
          code: 'custom',
          path: ['authUsername'],
          message: m.trino_auth_username_required()
        });
      }
      if (!data.authPassword) {
        ctx.addIssue({
          code: 'custom',
          path: ['authPassword'],
          message: m.trino_auth_password_required()
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
