import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { BucketDetails } from '$lib/storage/details-types.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import { createStorageProvider } from '$lib/server/storage/request-context.js';

export const GET: RequestHandler = async (event) => {
  const detailsParam = event.url.searchParams.get('details');
  const prefix = event.url.searchParams.get('prefix');

  if (detailsParam === 'true') {
    const { provider, bucket } = createStorageProvider(event);

    event.locals.logger.debug({ bucket }, 'fetching bucket details');

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

    return json(details);
  }

  if (!prefix) {
    const config = event.locals.storageConfig;
    if (!config) {
      throw error(401, 'No storage connection configured');
    }

    const listedBuckets = await getConnectionProvider(config).listContainers();
    const additional = config.additionalBuckets ?? [];
    const allBuckets = [...new Set([...listedBuckets, ...additional])];
    event.locals.logger.debug({ bucket_count: allBuckets.length }, 'bucket list returned');
    return json(allBuckets);
  }

  return json([]);
};
