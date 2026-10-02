import { z } from 'zod';

function isValidHostname(host: string): boolean {
  if (host.length > 253 || host.length === 0) return false;
  return host.split('.').every((label) => {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    return [...label].every(
      (char) =>
        (char >= 'a' && char <= 'z') ||
        (char >= 'A' && char <= 'Z') ||
        (char >= '0' && char <= '9') ||
        char === '-'
    );
  });
}

function isValidHost(host: string): boolean {
  return (
    host === 'localhost' ||
    z.ipv4().safeParse(host).success ||
    z.ipv6().safeParse(host).success ||
    isValidHostname(host)
  );
}

function hasInvalidStorageNameCharacter(value: string): boolean {
  return [...value].some((char) => {
    const codePoint = char.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f || '<>\\|?"'.includes(char);
  });
}

const baseStorageConnectionObject = z.object({
  id: z.string().uuid().optional(),
  name: z.string().optional(),
  type: z.enum(['s3', 'hdfs']).default('s3'),
  host: z
    .string()
    .trim()
    .min(1, 'Host is required')
    .refine((value) => {
      if (!value.includes('://')) return true;
      return z.url().safeParse(value).success;
    }, 'Host must be a valid hostname or IP address')
    .transform((v) => {
      if (!v.includes('://')) return v;
      return new URL(v).hostname;
    })
    .refine(isValidHost, 'Host must be a valid hostname or IP address'),
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
});

export const StorageConnectionSchema = baseStorageConnectionObject.superRefine((data, ctx) => {
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

/**
 * Schema variant for the edit form. Identical to StorageConnectionSchema except
 * that a blank secretKey is allowed when accessKey is provided — leaving it blank
 * means "keep the existing secret key".
 */
export const EditStorageConnectionSchema = baseStorageConnectionObject.superRefine((data, ctx) => {
  if (!data.credentials.accessKey && !!data.credentials.secretKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['credentials', 'accessKey'],
      message: 'Access key is required when secret key is provided'
    });
  }
});

export const ConnectionIdSchema = z.object({
  connectionId: z.string().uuid()
});

/** Object names accepted by the storage UI and API. */
export const StorageObjectNameSchema = z
  .string()
  .trim()
  .min(1, 'Object name is required')
  .refine(
    (value) => !hasInvalidStorageNameCharacter(value),
    'Object name contains invalid characters'
  )
  .refine(
    (value) => value.split('/').every((part) => part !== '.' && part !== '..'),
    'Object name cannot contain relative path segments'
  );

const StoragePrefixSchema = z
  .string()
  .refine(
    (value) =>
      value === '' ||
      (!hasInvalidStorageNameCharacter(value) &&
        value.split('/').every((part) => part !== '.' && part !== '..')),
    'Object prefix contains invalid characters'
  );

export const CopyObjectsBodySchema = z
  .object({
    sourceKeys: z.array(StorageObjectNameSchema).min(1, 'At least one source key is required'),
    destinationPrefix: StoragePrefixSchema,
    sourceBucket: z.string().trim().min(1).optional(),
    jobId: z.string().min(1).optional()
  })
  .strict();

export const MoveObjectsBodySchema = z
  .object({
    sourceKeys: z.array(StorageObjectNameSchema).min(1, 'At least one source key is required'),
    destinationPrefix: StoragePrefixSchema.optional(),
    destinationKey: StorageObjectNameSchema.optional(),
    sourceBucket: z.string().trim().min(1).optional(),
    jobId: z.string().min(1).optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.destinationPrefix === undefined && data.destinationKey === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['destinationPrefix'],
        message: 'A destination prefix or destination key is required'
      });
    }
    if (data.destinationKey !== undefined && data.sourceKeys.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['destinationKey'],
        message: 'A destination key requires exactly one source key'
      });
    }
  });

export const DeleteObjectsBodySchema = z
  .object({ keys: z.array(StorageObjectNameSchema).min(1, 'At least one object key is required') })
  .strict();

export const AddConnectionBucketBodySchema = z
  .object({ bucket: z.string().trim().min(1, 'Bucket name is required') })
  .strict();

/** Shape persisted in an encrypted storage connection payload. */
export const StoredStorageConnectionSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  tls: z.object({ verification: z.enum(['Full', 'None']) }).optional(),
  accessStyle: z.enum(['Path', 'VirtualHosted']),
  region: z.object({ name: z.string().min(1) }),
  credentials: z.object({ accessKey: z.string(), secretKey: z.string() }).optional()
});
