import type { PageServerLoad } from './$types';
import { getUserConnection } from '$lib/server/storage/user-connections.js';
import { StorageProviderFactory } from '$lib/server/storage/factory.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { error } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';

export const load: PageServerLoad = async ({ locals, params }) => {
  const userId = getUserId(locals);
  const connection = getUserConnection(userId);

  if (!connection) {
    throw error(401, 'No storage connection configured');
  }

  if (connection.type !== 's3') {
    throw error(400, 'Storage backend not supported');
  }

  const prefix = params.prefix ? params.prefix + '/' : '';
  const bucket = params.bucket;

  locals.logger.debug({ bucket, prefix }, 'loading storage bucket objects');

  const provider = StorageProviderFactory.create({ ...connection, bucket });

  try {
    const objects = await provider.listObjects(prefix, 50, 1);
    return { objects, prefix, bucket };
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const code = err.name;
      locals.logger.warn({ bucket, prefix, error_code: code }, 'S3 error loading bucket objects');

      if (code === 'AccessDenied' || err.$metadata?.httpStatusCode === 403) {
        throw error(403, `Access denied to bucket "${bucket}"`);
      }
      if (code === 'NoSuchBucket' || err.$metadata?.httpStatusCode === 404) {
        throw error(404, `Bucket "${bucket}" not found`);
      }
      throw error(502, `Storage error: ${err.message}`);
    }
    throw err;
  }
};
