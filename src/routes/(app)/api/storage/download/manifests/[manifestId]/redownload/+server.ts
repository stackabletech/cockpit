import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recreateDownloadManifest } from '$lib/server/storage/download-manifests.js';
import { RedownloadManifestBodySchema } from '$lib/storage/schemas.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const parsed = RedownloadManifestBodySchema.safeParse(await request.json());
  if (!parsed.success) throw error(400, 'Request body must contain one or more object keys');
  const { keys } = parsed.data;
  if (new Set(keys).size !== keys.length)
    throw error(400, 'Download keys must not contain duplicates');
  const manifest = await recreateDownloadManifest(
    locals.user?.id ?? 'anonymous',
    params.manifestId,
    keys,
    request.signal
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
