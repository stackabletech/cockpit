import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
  createDownloadManifest,
  clearDownloadHistory,
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
    keys.length > 1000 ||
    keys.some(
      (key) => typeof key !== 'string' || !key || new TextEncoder().encode(key).length > 1024
    )
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
  if (connectionId && !z.uuid().safeParse(connectionId).success)
    throw error(400, 'Invalid connection ID');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw error(400, 'Invalid history offset');
  const history = await listDownloadHistory(locals.user?.id ?? 'anonymous', connectionId, offset);
  return json(history);
};

export const DELETE: RequestHandler = async (event) => {
  await clearDownloadHistory(event.locals.user?.id ?? 'anonymous');
  return new Response(null, { status: 204 });
};
