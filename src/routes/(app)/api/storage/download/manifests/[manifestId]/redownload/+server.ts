import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recreateDownloadManifest } from '$lib/server/storage/download-manifests.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const keys = ((await request.json()) as { keys?: unknown }).keys;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some((key) => typeof key !== 'string' || !key)
  ) {
    throw error(400, 'Request body must contain one or more object keys');
  }
  if (new Set(keys).size !== keys.length)
    throw error(400, 'Download keys must not contain duplicates');
  const manifest = await recreateDownloadManifest(
    locals.user?.id ?? 'anonymous',
    params.manifestId,
    keys
  );
  if (!manifest)
    throw error(
      404,
      'Download history entry, storage connection, or selected objects are unavailable'
    );
  locals.logger.info(
    { manifest_id: manifest.id, source_manifest_id: params.manifestId, key_count: keys.length },
    'download history entry recreated'
  );
  return json(manifest, { status: 201 });
};
