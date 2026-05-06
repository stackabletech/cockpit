export type FileIconKind = 'image' | 'pdf' | 'code' | 'archive' | 'text' | 'document';

const CODE_TYPES = new Set([
  'application/json',
  'text/css',
  'text/html',
  'application/javascript',
  'text/javascript',
  'text/markdown'
]);

const ARCHIVE_TYPES = new Set(['application/gzip', 'application/zip', 'application/x-tar']);

export function fileIconKind(contentType: string | undefined): FileIconKind {
  if (!contentType) return 'document';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (CODE_TYPES.has(contentType)) return 'code';
  if (ARCHIVE_TYPES.has(contentType)) return 'archive';
  if (contentType.startsWith('text/')) return 'text';
  return 'document';
}

export const iconColors: Record<FileIconKind, string> = {
  image: 'text-success',
  pdf: 'text-error',
  code: 'text-info',
  archive: 'text-secondary',
  text: 'text-warning',
  document: 'text-primary'
};

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
}

/** Derive a human-readable display name from an S3 key. */
export function keyToName(key: string): string {
  const stripped = key.endsWith('/') ? key.slice(0, -1) : key;
  return stripped.split('/').at(-1) ?? key;
}
