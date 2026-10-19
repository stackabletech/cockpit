import { describe, expect, it } from 'vitest';
import { numberedName } from './numbered-name.js';

describe('numberedName', () => {
  it.each([
    ['report.csv', 'report (1).csv'],
    ['report.v2.csv', 'report.v2 (1).csv'],
    ['archive.tar.gz', 'archive.tar (1).gz'],
    ['.env', '.env (1)'],
    ['README', 'README (1)'],
    ['v1.2/', 'v1.2 (1)/'],
    ['.config/', '.config (1)/'],
    ['dir.v2/file', 'dir.v2/file (1)'],
    ['dir.v2/notes.txt', 'dir.v2/notes (1).txt'],
    ['a.b/c.d/v1.2/', 'a.b/c.d/v1.2 (1)/'],
    ['a.b/.env', 'a.b/.env (1)']
  ])('numbers %s as %s', (key, expected) => {
    expect(numberedName(key, 1)).toBe(expected);
  });

  it('uses the given counter', () => {
    expect(numberedName('dir/report.csv', 3)).toBe('dir/report (3).csv');
  });
});
