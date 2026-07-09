import { error } from '@sveltejs/kit';
import { uploadObject } from '$lib/server/storage/service.js';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucketKey } from '../params.js';
import { maxEditableFileSize } from '$lib/server/feature-flags.js';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * POST /api/storage/save-text?bucket=<bucket>&key=<key>&contentType=<type>&originalSize=<number>&previewBytes=<number>
 *
 * Saves edited text content back to S3. When the original file was truncated
 * during preview (previewBytes < originalSize), the endpoint fetches the
 * unseen tail of the original file, concatenates it with the edited text, and
 * uploads the combined result. This preserves the portion of the file that
 * was not visible in the editor.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const log = locals.logger;
  const { bucket, key } = requireBucketKey(url);

  const contentType = url.searchParams.get('contentType')?.trim() || 'text/plain';
  const rawOriginalSize = url.searchParams.get('originalSize');
  const rawPreviewBytes = url.searchParams.get('previewBytes');

  const originalSize = parseInt(rawOriginalSize ?? '0', 10);
  if (!Number.isFinite(originalSize) || originalSize < 0) {
    throw error(400, 'Invalid originalSize: must be a non-negative integer');
  }
  const previewBytes = parseInt(rawPreviewBytes ?? String(originalSize), 10);
  if (!Number.isFinite(previewBytes) || previewBytes < 0) {
    throw error(400, 'Invalid previewBytes: must be a non-negative integer');
  }

  if (!request.body) {
    throw error(400, 'Missing request body');
  }

  if (originalSize > maxEditableFileSize) {
    log.warn(
      { bucket, key, original_size: originalSize, max_editable_size: maxEditableFileSize },
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

  // Read the entire edited text body into a buffer
  const editReader = request.body.getReader();
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
    const provider = getProvider(locals.storageConfig!, bucket);

    // Fetch the unseen tail of the original file
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

    // Concatenate edited text + original tail
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
    // Not truncated — concatenate chunks into a single buffer
    const merged = new Uint8Array(totalEditBytes);
    let offset = 0;
    for (const chunk of editChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    mergedBuffer = Buffer.from(merged.buffer);
    totalLength = totalEditBytes;
  }

  await uploadObject(locals.storageConfig!, bucket, key, mergedBuffer, contentType, totalLength);

  log.info({ bucket, key }, 'save-text completed');

  return new Response(null, { status: 200 });
};
