import { z } from 'zod';

export const StorageConnectionSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().optional(),
    type: z.enum(['s3', 'hdfs']).default('s3'),
    host: z.string().min(1, 'Host is required'),
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    tls: z.object({ verification: z.enum(['Full', 'None']) }).optional(),
    accessStyle: z.enum(['Path', 'VirtualHosted']).default('VirtualHosted'),
    region: z.object({ name: z.string().min(1) }).default({ name: 'us-east-1' }),
    credentials: z
      .object({
        accessKey: z.string(),
        secretKey: z.string()
      })
      .default({ accessKey: '', secretKey: '' })
  })
  .superRefine((data, ctx) => {
    const hasKey = !!data.credentials.accessKey;
    const hasSecret = !!data.credentials.secretKey;
    if (hasKey && !hasSecret) {
      ctx.addIssue({
        code: 'custom',
        path: ['credentials', 'secretKey'],
        message: 'Secret key is required when access key is provided'
      });
    }
    if (!hasKey && hasSecret) {
      ctx.addIssue({
        code: 'custom',
        path: ['credentials', 'accessKey'],
        message: 'Access key is required when secret key is provided'
      });
    }
  });
