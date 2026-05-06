import { z } from 'zod';

export const StorageConnectionSchema = z
  .object({
    type: z.enum(['s3', 'hdfs']).default('s3'),
    endpoint: z.url({ message: 'Must be a valid URL' }).or(z.literal('')).optional(),
    region: z.string().min(1).default('eu-central-1'),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional()
  })
  .superRefine((data, ctx) => {
    const hasKey = !!data.accessKeyId;
    const hasSecret = !!data.secretAccessKey;
    if (hasKey && !hasSecret) {
      ctx.addIssue({
        code: 'custom',
        path: ['secretAccessKey'],
        message: 'Secret access key is required when access key ID is provided'
      });
    }
    if (!hasKey && hasSecret) {
      ctx.addIssue({
        code: 'custom',
        path: ['accessKeyId'],
        message: 'Access key ID is required when secret access key is provided'
      });
    }
  });
