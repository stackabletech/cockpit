import type pino from 'pino';
import type { StorageProvider } from '$lib/server/storage/provider.js';

/** Maximum bytes fetched for text-based previews (256 KiB). */
const TEXT_PREVIEW_BYTES = 256 * 1024;
/** Maximum bytes fetched for image previews (5 MiB). */
const IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024;
/** Maximum bytes fetched for PDF previews (25 MiB). */
const PDF_PREVIEW_BYTES = 25 * 1024 * 1024;

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
    limitBytes = IMAGE_PREVIEW_BYTES;
  } else if (contentType === 'application/pdf') {
    limitBytes = PDF_PREVIEW_BYTES;
  } else {
    limitBytes = TEXT_PREVIEW_BYTES;
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

  const stream =
    previewBytes === totalSize
      ? (await provider.getObject(key)).stream
      : await provider.getObjectRange(key, 0, previewBytes - 1);

  return new Response(stream, {
    headers: {
      'Content-Type': contentType,
      'X-Preview-Renderable': 'true',
      'X-Preview-Truncated': String(truncated),
      'X-Preview-Total-Size': String(totalSize),
      'X-Preview-Bytes': String(previewBytes),
      'Cache-Control': 'no-store'
    }
  });
}
