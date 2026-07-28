import { describe, it, expect, vi } from 'vitest';
import { fileIconKind, keyToName, formatDate, isArchiveExtension } from './utils.js';

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'en-GB'
}));

describe('fileIconKind', () => {
  it('returns "document" for undefined content type', () => {
    expect(fileIconKind(undefined)).toBe('document');
  });

  it('returns "image" for image types', () => {
    expect(fileIconKind('image/png')).toBe('image');
    expect(fileIconKind('image/jpeg')).toBe('image');
    expect(fileIconKind('image/svg+xml')).toBe('image');
  });

  it('returns "pdf" for application/pdf', () => {
    expect(fileIconKind('application/pdf')).toBe('pdf');
  });

  it('returns "code" for code types', () => {
    expect(fileIconKind('application/json')).toBe('code');
    expect(fileIconKind('text/html')).toBe('code');
    expect(fileIconKind('text/css')).toBe('code');
    expect(fileIconKind('application/javascript')).toBe('code');
    expect(fileIconKind('text/javascript')).toBe('code');
    expect(fileIconKind('text/markdown')).toBe('code');
  });

  it('returns "archive" for archive types', () => {
    expect(fileIconKind('application/zip')).toBe('archive');
    expect(fileIconKind('application/gzip')).toBe('archive');
    expect(fileIconKind('application/x-tar')).toBe('archive');
    expect(fileIconKind('application/x-gzip')).toBe('archive');
  });

  it('returns "text" for text types', () => {
    expect(fileIconKind('text/plain')).toBe('text');
    expect(fileIconKind('text/csv')).toBe('text');
  });

  it('returns "document" for unknown types', () => {
    expect(fileIconKind('application/octet-stream')).toBe('document');
    expect(fileIconKind('video/mp4')).toBe('document');
  });
});

describe('keyToName', () => {
  it('extracts filename from a key', () => {
    expect(keyToName('path/to/file.txt')).toBe('file.txt');
  });

  it('handles single segment', () => {
    expect(keyToName('file.txt')).toBe('file.txt');
  });

  it('strips trailing slash for directory keys', () => {
    expect(keyToName('path/to/dir/')).toBe('dir');
  });

  it('returns the key itself for root-level keys', () => {
    expect(keyToName('rootfile')).toBe('rootfile');
  });
});

describe('formatDate', () => {
  it('formats a date in en-GB short format', () => {
    const date = new Date('2024-03-15T10:00:00Z');
    expect(formatDate(date)).toBe('15 Mar 2024');
  });
});

describe('isArchiveExtension', () => {
  it('returns true for known archive extensions', () => {
    expect(isArchiveExtension('file.zip')).toBe(true);
    expect(isArchiveExtension('file.tar.gz')).toBe(true);
    expect(isArchiveExtension('file.tgz')).toBe(true);
    expect(isArchiveExtension('file.tar')).toBe(true);
    expect(isArchiveExtension('file.rar')).toBe(true);
    expect(isArchiveExtension('file.7z')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isArchiveExtension('file.ZIP')).toBe(true);
    expect(isArchiveExtension('file.TAR.GZ')).toBe(true);
  });

  it('returns false for non-archive extensions', () => {
    expect(isArchiveExtension('file.txt')).toBe(false);
    expect(isArchiveExtension('file.pdf')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isArchiveExtension('')).toBe(false);
  });
});
