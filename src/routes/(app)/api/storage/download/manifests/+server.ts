import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createDownloadManifest,
  listDownloadHistory
} from '$lib/server/storage/download-manifests.js';
import {
  requireBucket,
  requireConfig,
  requireStorageConnectionId
} from '$lib/server/storage/request-context.js';

export const POST: RequestHandler = async (event) => {
  const bucket = requireBucket(event);
  const config = requireConfig(event);
  const connectionId = requireStorageConnectionId(event);
  const prefix = event.url.searchParams.get('prefix')?.trim() ?? '';
  const keys = ((await event.request.json()) as { keys?: unknown }).keys;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some((key) => typeof key !== 'string' || !key)
  ) {
    throw error(400, 'Request body must contain one or more object keys');
  }
  const userId = event.locals.user?.id ?? 'anonymous';
  const manifest = await createDownloadManifest({
    userId,
    connectionId,
    bucket,
    prefix,
    keys: [...new Set(keys)],
    config
  });
  event.locals.logger.info(
    { manifest_id: manifest.id, bucket, key_count: keys.length },
    'download manifest prepared'
  );
  return json(manifest, { status: 201 });
};

export const GET: RequestHandler = async ({ locals, url }) => {
  const connectionId = url.searchParams.get('connectionId') ?? undefined;
  const history = await listDownloadHistory(locals.user?.id ?? 'anonymous', connectionId);
  return json(history);
};
