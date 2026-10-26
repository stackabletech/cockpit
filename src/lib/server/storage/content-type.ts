const MIME_BY_EXTENSION = new Map<string, string>([
  ['txt', 'text/plain'],
  ['csv', 'text/csv'],
  ['tsv', 'text/tab-separated-values'],
  ['json', 'application/json'],
  ['xml', 'application/xml'],
  ['html', 'text/html'],
  ['css', 'text/css'],
  ['js', 'application/javascript'],
  ['md', 'text/markdown'],
  ['yaml', 'application/x-yaml'],
  ['yml', 'application/x-yaml'],
  ['parquet', 'application/octet-stream'],
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'],
  ['webp', 'image/webp'],
  ['log', 'text/plain'],
  ['py', 'text/plain'],
  ['java', 'text/plain'],
  ['ts', 'text/plain'],
  ['sql', 'text/plain'],
  ['zip', 'application/zip'],
  ['gz', 'application/gzip'],
  ['tar', 'application/x-tar'],
  ['avro', 'application/avro'],
  ['orc', 'application/orc']
]);

/**
 * Guess a MIME type from a file name's extension. Used where the backend
 * stores no content type (HDFS, archive entries).
 */
export function guessContentType(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXTENSION.get(ext) ?? 'application/octet-stream';
}
