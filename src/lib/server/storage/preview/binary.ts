/**
 * Content types that are definitively binary and cannot be rendered as text.
 * For these we skip the body fetch entirely and tell the client upfront.
 */
export const KNOWN_BINARY_TYPES = new Set([
  'application/gzip',
  'application/x-gzip',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
  'application/x-zstd',
  'application/zstd',
  'application/avro',
  'application/x-avro',
  'application/orc',
  'application/x-orc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

export function binaryPreview(contentType: string, totalSize: number): Response {
  return new Response(null, {
    headers: {
      'Content-Type': contentType,
      'X-Preview-Renderable': 'false',
      'X-Preview-Total-Size': String(totalSize),
      'X-Preview-Bytes': '0',
      'X-Preview-Truncated': 'false',
      'Cache-Control': 'no-store'
    }
  });
}
