import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';
import type { BucketDetails } from '$lib/storage/details-types.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const bucket = requireBucket(url);

  locals.logger.debug({ bucket }, 'fetching bucket details');

  const provider = getProvider(locals.storageConfig!, bucket);

  const [versioning, lifecycleRules, tags, acl] = await Promise.all([
    provider.getBucketVersioning(),
    provider.getBucketLifecycleRules(),
    provider.getBucketTags(),
    provider.getBucketAcl()
  ]);

  const details: BucketDetails = {
    name: bucket,
    versioning: versioning as 'Enabled' | 'Suspended' | 'Disabled',
    lifecycleRules,
    tags,
    acl
  };

  return Response.json(details);
};
