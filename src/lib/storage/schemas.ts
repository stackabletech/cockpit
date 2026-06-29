import { z } from 'zod';

/**
 * Schema used to validate and save a new named storage connection.
 * The `name` field is auto-generated from the endpoint but editable by the user.
 * `additionalBuckets` is a newline-separated list of bucket names to include
 * alongside the auto-discovered bucket list.
 */
export const SaveConnectionSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100),
    type: z.enum(['s3', 'hdfs']).default('s3'),
    endpoint: z.string().url({ message: 'Must be a valid URL' }).or(z.literal('')).optional(),
    pathStyle: z.boolean().default(true),
    region: z.string().min(1).default('eu-central-1'),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    additionalBuckets: z.string().optional()
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

export const StorageConnectionSchema = z
  .object({
    type: z.enum(['s3', 'hdfs']).default('s3'),
    endpoint: z.url({ message: 'Must be a valid URL' }).or(z.literal('')).optional(),
    pathStyle: z.boolean().default(true),
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

export const ConnectionIdSchema = z.object({
  connectionId: z.string().uuid()
});
