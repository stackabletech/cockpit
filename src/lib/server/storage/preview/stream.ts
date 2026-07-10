import type pino from 'pino';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import {
  textPreviewBytes,
  imagePreviewBytes,
  pdfPreviewBytes,
  filePreviewRows
} from '$lib/server/feature-flags.js';

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
      'X-Preview-Preview-Rows': String(filePreviewRows),
      'Cache-Control': 'no-store'
    }
  });
}
