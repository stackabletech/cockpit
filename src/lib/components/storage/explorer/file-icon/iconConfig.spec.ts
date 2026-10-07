import { describe, expect, it } from 'vitest';
import { fileIconKind } from './iconConfig.js';

describe('fileIconKind', () => {
  it.each([undefined, 'application/octet-stream', 'binary/octet-stream'])(
    'uses extensions for missing or generic content type %s',
    (contentType) => {
      for (const extension of ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst']) {
        expect(fileIconKind(contentType, `folder/archive.${extension.toUpperCase()}`)).toBe(
          'archive'
        );
      }
      expect(fileIconKind(contentType, 'folder/report.pdf')).toBe('pdf');
      expect(fileIconKind(contentType, 'folder/data.csv')).toBe('csv');
      expect(fileIconKind(contentType, 'folder/file.unknown')).toBe('document');
      expect(fileIconKind(contentType)).toBe('document');
    }
  );

  it('keeps specific content types authoritative', () => {
    expect(fileIconKind('text/plain', 'archive.7z')).toBe('text');
    expect(fileIconKind('application/zip', 'file.unknown')).toBe('archive');
    expect(fileIconKind('image/png', 'report.pdf')).toBe('image');
  });
});
