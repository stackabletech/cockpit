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

function isIpv6(host: string): boolean {
  return z.ipv6().safeParse(host).success;
}

/** Hosts are stored as they appear in a URL, so IPv6 literals are bracketed (`[::1]`). */
function isValidHost(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return isIpv6(host.slice(1, -1));
  return host === 'localhost' || z.ipv4().safeParse(host).success || isValidHostname(host);
}

function hasInvalidStorageNameCharacter(value: string): boolean {
  return [...value].some((char) => {
    const codePoint = char.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f || '<>\\|?"'.includes(char);
  });
}

/** S3 limits object keys to 1024 bytes of UTF-8. */
const MAX_OBJECT_KEY_BYTES = 1024;

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
      if (v.includes('://')) return new URL(v).hostname;
      return isIpv6(v) ? `[${v}]` : v;
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

/**
 * Object keys the storage API receives in key parameters and bodies: existing keys (read routes,
 * delete, move and copy sources), keys about to be written (create, upload, save-text, move
 * destination) and destination prefixes. Other tools can create any key S3 accepts, including `?`,
 * `\`, `..` segments or control characters, so exactly S3's own constraint applies: non-empty and
 * at most 1024 bytes of UTF-8. Names the user types are checked on the client with
 * StorageObjectNameSchema. Not trimmed: trimming would address a different object. Keys never
 * become local paths or header values without sanitising.
 */
export const StorageObjectKeySchema = z
  .string()
  .min(1, 'Object key is required')
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAX_OBJECT_KEY_BYTES,
    'Object key is too long'
  );

/**
 * Object names the user types when creating or renaming. Stricter than StorageObjectKeySchema as a
 * UX policy: names that are awkward in shells, URLs or other tools are refused. Not trimmed: S3
 * keys may legitimately start or end with whitespace, and trimming would address a different
 * object. Callers trim user input.
 */
export const StorageObjectNameSchema = z
  .string()
  .min(1, 'Object name is required')
  .refine(
    (value) => !hasInvalidStorageNameCharacter(value),
    'Object name contains invalid characters'
  )
  .refine(
    (value) => value.split('/').every((part) => part !== '.' && part !== '..'),
    'Object name cannot contain relative path segments'
  );

/**
 * A replacement name chosen in the conflict dialog. It renames the item in place, so it is a
 * single path segment: a `/` would move the item into another folder.
 */
export const ConflictRenameNameSchema = StorageObjectNameSchema.refine(
  (value) => !value.includes('/'),
  'Name cannot contain "/"'
);

/** An existing folder to paste into; empty for the bucket root. */
const StoragePrefixSchema = z.union([z.literal(''), StorageObjectKeySchema]);

export const CopyObjectsBodySchema = z
  .object({
    sourceKeys: z.array(StorageObjectKeySchema).min(1, 'At least one source key is required'),
    destinationPrefix: StoragePrefixSchema,
    sourceBucket: z.string().trim().min(1).optional(),
    jobId: z.string().min(1).optional()
  })
  .strict();

export const MoveObjectsBodySchema = z
  .object({
    sourceKeys: z.array(StorageObjectKeySchema).min(1, 'At least one source key is required'),
    destinationPrefix: StoragePrefixSchema.optional(),
    destinationKey: StorageObjectKeySchema.optional(),
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
  .object({ keys: z.array(StorageObjectKeySchema).min(1, 'At least one object key is required') })
  .strict();

export const DownloadManifestBodySchema = z.object({
  keys: z.array(StorageObjectKeySchema).min(1).max(1000)
});

export const RedownloadManifestBodySchema = z.object({
  keys: z.array(StorageObjectKeySchema).min(1).max(10_000)
});

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

/** Superforms message returned by the storage connect and edit actions. */
export type StorageConnectionMessage = { type: 'success' } | { type: 'error'; message: string };
