import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { maxEditableFileSize } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/storage/save-text?bucket=<bucket>&key=<object-key>&originalSize=<n>&previewBytes=<n>&contentType=<type>
 *
 * Saves edited text content for a storage object. The request body is the raw
 * text to save. When `previewBytes < originalSize`, the tail of the original
 * file is fetched and merged with the edited portion so only the beginning of
 * the file was transmitted to the client for editing.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const key = event.url.searchParams.get('key')?.trim();
  if (!key) throw error(400, 'Missing required query parameter: key');
  const log = event.locals.logger;

  const contentType = event.url.searchParams.get('contentType')?.trim() || 'text/plain';
  const rawOriginalSize = event.url.searchParams.get('originalSize');
  const rawPreviewBytes = event.url.searchParams.get('previewBytes');
  const originalSize = rawOriginalSize ? parseInt(rawOriginalSize, 10) : NaN;
  const previewBytes = rawPreviewBytes ? parseInt(rawPreviewBytes, 10) : originalSize;

  if (!Number.isFinite(originalSize) || originalSize < 0) {
    throw error(400, 'Invalid originalSize: must be a non-negative integer');
  }
  if (!Number.isFinite(previewBytes) || previewBytes < 0) {
    throw error(400, 'Invalid previewBytes: must be a non-negative integer');
  }

  if (!event.request.body) throw error(400, 'Missing request body');

  if (originalSize > maxEditableFileSize) {
    log.warn(
      {
        bucket,
        key,
        original_size: originalSize,
        max_editable_size: maxEditableFileSize
      },
      'save-text rejected: file exceeds max editable size (read-only)'
    );
    throw error(413, 'File exceeds the maximum editable size and is read-only');
  }

  const truncated = previewBytes > 0 && previewBytes < originalSize;

  log.debug(
    {
      bucket,
      key,
      content_type: contentType,
      original_size: originalSize,
      preview_bytes: previewBytes,
      truncated
    },
    'save-text request received'
  );

  const editReader = event.request.body.getReader();
  const editChunks: Uint8Array[] = [];
  let totalEditBytes = 0;
  while (true) {
    const { done, value } = await editReader.read();
    if (done) break;
    editChunks.push(value);
    totalEditBytes += value.length;
    if (totalEditBytes > maxEditableFileSize) {
      editReader.cancel();
      throw error(413, 'File exceeds the maximum editable size and is read-only');
    }
  }

  let mergedBuffer: Buffer;
  let totalLength: number;

  if (truncated) {
    const tailStream = await provider.getObjectRange(key, previewBytes, originalSize - 1);
    const tailReader = tailStream.getReader();
    const tailChunks: Uint8Array[] = [];
    let totalTailBytes = 0;
    while (true) {
      const { done, value } = await tailReader.read();
      if (done) break;
      tailChunks.push(value);
      totalTailBytes += value.length;
    }

    const merged = new Uint8Array(totalEditBytes + totalTailBytes);
    let offset = 0;
    for (const chunk of editChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    for (const chunk of tailChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    mergedBuffer = Buffer.from(merged.buffer);
    totalLength = merged.length;

    log.info(
      {
        bucket,
        key,
        edit_bytes: totalEditBytes,
        tail_bytes: totalTailBytes,
        total_bytes: totalLength
      },
      'saving truncated file with tail merge'
    );
  } else {
    const merged = new Uint8Array(totalEditBytes);
    let offset = 0;
    for (const chunk of editChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    mergedBuffer = Buffer.from(merged.buffer);
    totalLength = totalEditBytes;
  }

  await provider.putObject(key, mergedBuffer, contentType, totalLength);

  log.info({ bucket, key }, 'save-text completed');

  return new Response(null, { status: 200 });
};
