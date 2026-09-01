import { describe, expect, it } from 'vitest';
import { selectedDownloadHistoryPayloadSize } from './download-history.js';

const entries = [
  { key: 'a.txt', size: 10, isDirectory: false },
  { key: 'folder/', size: 0, isDirectory: true },
  { key: 'folder/b.txt', size: 20, isDirectory: false },
  { key: 'folder/nested/c.txt', size: 30, isDirectory: false }
];

describe('selectedDownloadHistoryPayloadSize', () => {
  it('sums directly selected files', () => {
    expect(selectedDownloadHistoryPayloadSize(entries, ['a.txt', 'folder/b.txt'])).toBe(30);
  });

  it('expands selected directories to their stored descendants', () => {
    expect(selectedDownloadHistoryPayloadSize(entries, ['folder/'])).toBe(50);
  });

  it('deduplicates direct children selected alongside their directory', () => {
    expect(selectedDownloadHistoryPayloadSize(entries, ['folder/', 'folder/b.txt'])).toBe(50);
  });
});
