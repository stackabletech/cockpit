import { z } from 'zod';

const baseStorageConnectionObject = z.object({
  id: z.string().uuid().optional(),
  name: z.string().optional(),
  type: z.enum(['s3', 'hdfs']).default('s3'),
  host: z
    .string()
    .min(1, 'Host is required')
    .transform((v) => {
      // HDFS accepts a comma-separated NameNode list, parsed by the connect action.
      if (!v.includes('://') || v.includes(',')) return v;
      try {
        return new URL(v).hostname;
      } catch {
        // Fallback: strip scheme manually, take just the host part
        return v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/:?#]/)[0];
      }
    }),
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
    .default({ accessKey: '', secretKey: '' }),
  /** HDFS user name; only used when running without OIDC (dev mode). */
  devUser: z.string().trim().optional(),
  /** HDFS authentication: simple (`user.name`) or Kerberos (SPNEGO + proxy user). */
  auth: z.enum(['simple', 'kerberos']).default('simple'),
  /** HDFS SPNEGO service principal, e.g. `HTTP/hdfs.default.svc.cluster.local`. */
  servicePrincipal: z.string().trim().optional()
});

export const StorageConnectionSchema = baseStorageConnectionObject.superRefine((data, ctx) => {
  if (data.type !== 's3') return;
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
  if (data.type !== 's3') return;
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
