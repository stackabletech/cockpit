import { S3Client } from '@aws-sdk/client-s3';

declare const process: {
  env: Record<string, string | undefined>;
};

export type GarageCredentials = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type GarageBucketPermissions = {
  owner: boolean;
  read: boolean;
  write: boolean;
};

type JsonRecord = Record<string, unknown>;

const ADMIN_LIST_KEYS = ['items', 'results', 'data', 'buckets', 'keys'];

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function readString(value: unknown, keys: string[]): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function readStringArray(value: unknown, keys: string[]): string[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is string => typeof item === 'string');
    }
  }

  return [];
}

function extractAdminList(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map((item) => asRecord(item)).filter((item): item is JsonRecord => item !== null);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  for (const key of ADMIN_LIST_KEYS) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => asRecord(item))
        .filter((item): item is JsonRecord => item !== null);
    }
  }

  return [];
}

function requireGarageAdminConfig() {
  const adminUrl = process.env.GARAGE_ADMIN_URL;
  const adminToken = process.env.GARAGE_ADMIN_TOKEN;

  if (!adminUrl || !adminToken) {
    throw new Error('Garage admin API is not available for this test run');
  }

  return { adminUrl, adminToken };
}

async function adminGet(path: string): Promise<unknown> {
  const { adminUrl, adminToken } = requireGarageAdminConfig();
  const response = await fetch(`${adminUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Garage admin GET ${path} failed with ${response.status}`);
  }

  return response.json();
}

async function adminPost(path: string, body: unknown): Promise<unknown> {
  const { adminUrl, adminToken } = requireGarageAdminConfig();
  const response = await fetch(`${adminUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Garage admin POST ${path} failed with ${response.status}`);
  }

  return response.json();
}

async function findBucketId(bucketName: string): Promise<string | null> {
  const buckets = extractAdminList(await adminGet('/v2/ListBuckets'));

  for (const bucket of buckets) {
    const aliases = readStringArray(bucket, ['globalAliases', 'global_aliases']);
    const directAlias = readString(bucket, ['globalAlias', 'global_alias']);

    if (aliases.includes(bucketName) || directAlias === bucketName) {
      return readString(bucket, ['id', 'bucketId', 'bucket_id']);
    }
  }

  return null;
}

async function ensureBucket(bucketName: string): Promise<string> {
  const existingId = await findBucketId(bucketName);
  if (existingId) {
    return existingId;
  }

  const created = await adminPost('/v2/CreateBucket', { globalAlias: bucketName });
  const createdId = readString(created, ['id', 'bucketId', 'bucket_id']);

  if (createdId) {
    return createdId;
  }

  const refreshedId = await findBucketId(bucketName);
  if (!refreshedId) {
    throw new Error(`Garage bucket ${bucketName} was not found in admin API`);
  }

  return refreshedId;
}

async function findKeyId(keyName: string): Promise<string | null> {
  const keys = extractAdminList(await adminGet('/v2/ListKeys'));

  for (const key of keys) {
    const currentName = readString(key, ['name']);
    const expired = key.expired;

    if (currentName === keyName && expired !== true) {
      return readString(key, ['id', 'accessKeyId', 'access_key_id']);
    }
  }

  return null;
}

async function ensureAccessKey(keyName: string): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
}> {
  const existingId = await findKeyId(keyName);

  if (!existingId) {
    const created = await adminPost('/v2/CreateKey', { name: keyName, neverExpires: true });
    const accessKeyId = readString(created, ['accessKeyId', 'access_key_id', 'id']);
    const secretAccessKey = readString(created, ['secretAccessKey', 'secret_access_key']);

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(`Garage key ${keyName} was created without credentials`);
    }

    return { accessKeyId, secretAccessKey };
  }

  const info = await adminGet(
    `/v2/GetKeyInfo?id=${encodeURIComponent(existingId)}&showSecretKey=true`
  );
  const accessKeyId = readString(info, ['accessKeyId', 'access_key_id', 'id']) ?? existingId;
  const secretAccessKey = readString(info, ['secretAccessKey', 'secret_access_key']);

  if (!secretAccessKey) {
    throw new Error(`Garage key ${keyName} does not expose a secret access key`);
  }

  return { accessKeyId, secretAccessKey };
}

export function hasGarageCredentials(): boolean {
  return Boolean(
    process.env.S3_TEST_ENDPOINT &&
    process.env.S3_TEST_REGION &&
    process.env.S3_TEST_ACCESS_KEY_ID &&
    process.env.S3_TEST_SECRET_ACCESS_KEY &&
    process.env.S3_TEST_BUCKET
  );
}

export function hasGarageAdmin(): boolean {
  return Boolean(process.env.GARAGE_ADMIN_URL && process.env.GARAGE_ADMIN_TOKEN);
}

export function requireGarageCredentials(): GarageCredentials {
  const endpoint = process.env.S3_TEST_ENDPOINT;
  const region = process.env.S3_TEST_REGION;
  const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_TEST_BUCKET;

  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('Garage S3 test configuration is incomplete');
  }

  return { endpoint, region, accessKeyId, secretAccessKey, bucket };
}

export function createS3Client(credentials: GarageCredentials): S3Client {
  return new S3Client({
    endpoint: credentials.endpoint,
    region: credentials.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    }
  });
}

export async function createGarageBucketCredentials(
  baseCredentials: GarageCredentials,
  options: {
    bucketName: string;
    keyName: string;
    permissions: GarageBucketPermissions;
    /** Also grant owner+write access to this existing key ID (e.g. for seeding/cleanup). */
    ownerAccessKeyId?: string;
  }
): Promise<GarageCredentials> {
  const bucketId = await ensureBucket(options.bucketName);
  const key = await ensureAccessKey(options.keyName);

  await adminPost('/v2/AllowBucketKey', {
    bucketId,
    accessKeyId: key.accessKeyId,
    permissions: options.permissions
  });

  if (options.ownerAccessKeyId && options.ownerAccessKeyId !== key.accessKeyId) {
    await adminPost('/v2/AllowBucketKey', {
      bucketId,
      accessKeyId: options.ownerAccessKeyId,
      permissions: { owner: true, read: true, write: true }
    });
  }

  return {
    endpoint: baseCredentials.endpoint,
    region: baseCredentials.region,
    accessKeyId: key.accessKeyId,
    secretAccessKey: key.secretAccessKey,
    bucket: options.bucketName
  };
}

/**
 * Creates a bucket with no global alias (so it is absent from S3 ListBuckets
 * responses) and grants the given access key read and write — but not owner —
 * access.  Returns the Garage bucket ID, which is the only handle for the
 * bucket when it has no alias.
 */
export async function createGarageHiddenBucket(
  baseCredentials: GarageCredentials,
  accessKeyId: string
): Promise<string> {
  const created = await adminPost('/v2/CreateBucket', {});
  const bucketId = readString(created, ['id', 'bucketId', 'bucket_id']);

  if (!bucketId) {
    throw new Error('Garage hidden bucket was created without an ID');
  }

  await adminPost('/v2/AllowBucketKey', {
    bucketId,
    accessKeyId,
    permissions: { owner: false, read: true, write: true }
  });

  return bucketId;
}

export function hasHiddenBucketId(): boolean {
  return Boolean(process.env.S3_TEST_HIDDEN_BUCKET_ID);
}

export function requireHiddenBucketId(): string {
  const id = process.env.S3_TEST_HIDDEN_BUCKET_ID;

  if (!id) {
    throw new Error(
      'Hidden bucket ID is not available — S3_TEST_HIDDEN_BUCKET_ID is not set. ' +
        'Run the dev setup or ensure init-garage-s3.sh has run.'
    );
  }

  return id;
}
