/** Content types that are text even though they are not `text/*`. */
const TEXT_APPLICATION_TYPES = [
  'application/json',
  'application/yaml',
  'application/xml',
  'application/csv',
  'application/x-ndjson'
];

/** Whether a (parameter-free) content type denotes text. */
export function isTextContentType(contentType: string): boolean {
  return contentType.startsWith('text/') || TEXT_APPLICATION_TYPES.includes(contentType);
}

/**
 * Whether an object is text the inline editor can edit. CSV and TSV are text
 * but are rendered as tables, never in the editor. Shared by the server (to
 * decide whether a preview is loaded completely) and the client.
 */
export function isEditableTextObject(key: string, contentType: string): boolean {
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith('.csv') || lowerKey.endsWith('.tsv')) return false;
  if (['text/csv', 'application/csv', 'text/tab-separated-values'].includes(contentType)) {
    return false;
  }
  return isTextContentType(contentType);
}
