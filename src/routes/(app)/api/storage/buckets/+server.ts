import { json } from '@sveltejs/kit';
import { notConnected } from '$lib/server/storage/not-connected.js';
import type { RequestHandler } from './$types';
import type { BucketDetails } from '$lib/storage/details-types.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { withStorageHttpErrors } from '$lib/server/storage/wrap-provider.js';

export const GET: RequestHandler = async (event) => {
  const detailsParam = event.url.searchParams.get('details');

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
      versioning,
      lifecycleRules,
      tags,
      acl
    };

    return json(details);
  }

  const config = event.locals.storageConfig;
  if (!config) {
    notConnected();
  }

  const listedBuckets = await withStorageHttpErrors(getConnectionProvider(config)).listContainers();
  const additional = config.additionalBuckets ?? [];
  // Some S3 implementations (e.g. Garage) return buckets in no particular order.
  const allBuckets = [...new Set([...listedBuckets, ...additional])].sort();
  event.locals.logger.debug({ bucket_count: allBuckets.length }, 'bucket list returned');
  return json(allBuckets);
};
