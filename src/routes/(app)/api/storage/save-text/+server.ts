import { error, isHttpError, json } from '@sveltejs/kit';
import { z } from 'zod';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { maxEditableFileSize } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';

const saveTextQuerySchema = z.object({
  key: z.string().min(1, 'Missing required query parameter: key'),
  etag: z.string().trim().min(1, 'Missing required query parameter: etag'),
  contentType: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || 'text/plain')
});

const conflictMessage = 'The object was modified since it was loaded';

/**
 * POST /api/storage/save-text?bucket=<bucket>&key=<object-key>&etag=<etag>&contentType=<type>
 *
 * Replaces a storage object with the edited text in the request body. The body
 * is the complete new file content; the client only offers editing when it
 * loaded the complete, losslessly decoded file.
 *
 * `etag` is the ETag the content was loaded with. The save is refused with 409
 * when the object changed (or was deleted) since then: the current ETag is
 * compared via HEAD, and the PUT itself is conditional (`If-Match`) on
 * providers that support it. Responds with `{ etag }` of the written object.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const log = event.locals.logger;

  const query = saveTextQuerySchema.safeParse({
    key: event.url.searchParams.get('key') ?? '',
    etag: event.url.searchParams.get('etag') ?? '',
    contentType: event.url.searchParams.get('contentType') ?? undefined
  });
  if (!query.success) {
    throw error(400, query.error.issues[0]?.message ?? 'Invalid query parameters');
  }
  const { key, etag, contentType } = query.data;

  if (!event.request.body) throw error(400, 'Missing request body');

  log.debug({ bucket, key, content_type: contentType, etag }, 'save-text request received');

  const reader = event.request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalBytes += value.length;
    if (totalBytes > maxEditableFileSize) {
      await reader.cancel();
      log.warn(
        { bucket, key, max_editable_size: maxEditableFileSize },
        'save-text rejected: body exceeds max editable size'
      );
      throw error(413, 'File exceeds the maximum editable size and is read-only');
    }
  }
  const body = Buffer.concat(chunks, totalBytes);

  // Compare the current ETag right before writing. This is the only guard on
  // providers that ignore `If-Match` on PUT; elsewhere the conditional PUT
  // below also closes the window between this HEAD and the write.
  let current;
  try {
    current = await provider.getMetadata(key);
  } catch (err) {
    if (isHttpError(err) && err.status === 404) {
      log.info({ bucket, key }, 'save-text rejected: object was deleted since it was loaded');
      throw error(409, conflictMessage);
    }
    throw err;
  }
  if (current.etag !== etag) {
    log.info(
      { bucket, key, expected_etag: etag, current_etag: current.etag },
      'save-text rejected: object was modified since it was loaded'
    );
    throw error(409, conflictMessage);
  }
  if (current.size > maxEditableFileSize) {
    log.warn(
      { bucket, key, original_size: current.size, max_editable_size: maxEditableFileSize },
      'save-text rejected: file exceeds max editable size (read-only)'
    );
    throw error(413, 'File exceeds the maximum editable size and is read-only');
  }

  const newEtag = await provider.putObjectIfMatch(key, body, contentType, etag);

  log.info({ bucket, key, total_bytes: totalBytes }, 'save-text completed');

  return json({ etag: newEtag ?? null });
};
