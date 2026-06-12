import prettyBytes from 'pretty-bytes';
import type { Options } from 'pretty-bytes';
import { getLocale } from '$lib/paraglide/runtime.js';
import { ARCHIVE_EXTENSIONS } from './types.js';

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

/** Format a byte count using the active UI locale. */
export function formatFileSize(
  bytes: number,
  locale: string = getLocale(),
  options: Options = { fixedWidth: 9 }
): string {
  return prettyBytes(bytes, { locale, ...options });
}

/** Check if a filename/path has a navigable archive extension. */
export function isArchiveExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
