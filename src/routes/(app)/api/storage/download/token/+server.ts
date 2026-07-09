import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { STORAGE_CONNECTION_HEADER } from '$lib/storage/connection-storage.js';
import { parseConnectionPayload } from '$lib/server/storage/connection.js';
import { createDownloadToken } from '$lib/server/storage/download-tokens.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  const encoded = request.headers.get(STORAGE_CONNECTION_HEADER);
  if (!encoded) {
    throw error(400, 'Missing storage connection header');
  }

  const config = parseConnectionPayload(encoded);
  const token = createDownloadToken(config);

  locals.logger?.debug({ token: token.slice(0, 8) + '…' }, 'created download token');

  return json({ token });
};
