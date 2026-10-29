import type pino from 'pino';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import {
  textPreviewBytes,
  imagePreviewBytes,
  pdfPreviewBytes,
  filePreviewRows,
  filePreviewColumns,
  maxEditableFileSize
} from '$lib/server/storage/config.js';
import { isEditableTextObject } from '$lib/storage/text-content-type.js';

/**
 * Streams the first bytes of an object for preview. Editable text objects
 * (text content types except CSV/TSV) up to the editable size limit are sent
 * complete, so the editor never works on a truncated file. Whenever the whole
 * object is sent, the ETag of that GET is included (`X-Preview-ETag`) so saves
 * can be made conditional on it. Everything else keeps the size-based limits.
 */
export async function streamPreview(
  provider: StorageProvider,
  key: string,
  contentType: string,
  totalSize: number,
  userId: string,
  log: pino.Logger
): Promise<Response> {
  let limitBytes: number;
  if (contentType.startsWith('image/')) {
    limitBytes = imagePreviewBytes;
  } else if (contentType === 'application/pdf') {
    limitBytes = pdfPreviewBytes;
  } else if (isEditableTextObject(key, contentType) && totalSize <= maxEditableFileSize) {
    // Loaded completely so it can be edited and saved without splicing the
    // unseen tail back in.
    limitBytes = totalSize;
  } else {
    limitBytes = textPreviewBytes;
  }

  const previewBytes = Math.min(totalSize, limitBytes);
  const truncated = previewBytes < totalSize;

  log.info(
    {
      user_id: userId,
      key,
      content_type: contentType,
      preview_bytes: previewBytes,
      truncated
    },
    'fetching object preview'
  );

  let stream: ReadableStream;
  let etag: string | undefined;
  if (previewBytes === totalSize) {
    // Use the ETag of the GET itself so it always matches the bytes sent.
    ({ stream, etag } = await provider.getObject(key));
  } else {
    stream = await provider.getObjectRange(key, 0, previewBytes - 1);
  }

  return new Response(stream, {
    headers: {
      'Content-Type': contentType,
      'X-Preview-Renderable': 'true',
      'X-Preview-Truncated': String(truncated),
      'X-Preview-Total-Size': String(totalSize),
      'X-Preview-Bytes': String(previewBytes),
      'X-Preview-Preview-Rows': String(filePreviewRows),
      'X-Preview-Preview-Columns': String(filePreviewColumns),
      'Cache-Control': 'no-store',
      ...(etag ? { 'X-Preview-ETag': etag } : {})
    }
  });
}
