import { describe, expect, it } from 'vitest';
import { createSafeSearchRegex, UnsafeSearchRegexError } from './search-regex.js';

describe('createSafeSearchRegex', () => {
  it('creates a case-insensitive regex for safe patterns', () => {
    expect(createSafeSearchRegex('report-[0-9]+').test('REPORT-2026')).toBe(true);
  });

  it.each([
    '(a+)+$',
    '(a|aa)+$',
    'a*a*',
    '(?<x>a)\\k<x>',
    '(?=a)a',
    '(.*)(.*)(.*)!',
    '(?:.*)(?:.*)!',
    '.{0,1000}.{0,1000}.{0,1000}!',
    '(a|aa){0,20}!',
    '.{0,90}.{0,90}!'
  ])('rejects potentially expensive pattern %s', (pattern) => {
    expect(() => createSafeSearchRegex(pattern)).toThrow(UnsafeSearchRegexError);
  });

  it.each([
    'foo.*bar',
    'data/2026-0[1-9]/.*\\.csv',
    '(a|b|c).*',
    '.*\\.csv?',
    '.*\\.(csv|json|parquet|orc|avro)',
    '(jan|feb|mar|apr|may).*',
    'logs/.*-\\d{1,5}\\.gz'
  ])('accepts common pattern %s', (pattern) => {
    expect(() => createSafeSearchRegex(pattern)).not.toThrow();
  });

  it('rejects invalid syntax and overly long patterns', () => {
    expect(() => createSafeSearchRegex('[')).toThrow(UnsafeSearchRegexError);
    expect(() => createSafeSearchRegex('a'.repeat(513))).toThrow(UnsafeSearchRegexError);
  });
});
