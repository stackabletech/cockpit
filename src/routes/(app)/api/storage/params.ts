import { error } from '@sveltejs/kit';

/**
 * Extracts and validates the `bucket` query parameter from a storage API
 * request URL. Throws a 400 error if absent or blank. Surrounding whitespace is
 * removed, which is safe because S3 bucket names cannot contain whitespace.
 */
export function requireBucket(url: URL): string {
  const bucket = url.searchParams.get('bucket')?.trim();
  if (!bucket) {
    throw error(400, 'Missing required query parameter: bucket');
  }
  return bucket;
}

/**
 * Extracts and validates the `bucket` and `key` query parameters from a
 * storage API request URL. Throws a 400 error if the bucket is absent or blank,
 * or the key is absent or empty. The key is returned unchanged: S3 keys may
 * legitimately start or end with whitespace.
 */
export function requireBucketKey(url: URL): { bucket: string; key: string } {
  const bucket = requireBucket(url);

  const key = url.searchParams.get('key');
  if (!key) {
    throw error(400, 'Missing required query parameter: key');
  }

  return { bucket, key };
}
