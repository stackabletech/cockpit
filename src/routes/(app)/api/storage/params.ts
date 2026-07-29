import { error } from '@sveltejs/kit';

/**
 * Extracts and validates the `bucket` query parameter from a storage API
 * request URL. Throws a 400 error if absent or blank.
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
 * storage API request URL. Throws a 400 error if either is absent or blank.
 */
export function requireBucketKey(url: URL): { bucket: string; key: string } {
  const bucket = requireBucket(url);

  const key = url.searchParams.get('key')?.trim();
  if (!key) {
    throw error(400, 'Missing required query parameter: key');
  }

  return { bucket, key };
}
