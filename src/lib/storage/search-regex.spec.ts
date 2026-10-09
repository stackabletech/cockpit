import { describe, expect, it } from 'vitest';
import { createSafeSearchRegex, UnsafeSearchRegexError } from './search-regex.js';

describe('createSafeSearchRegex', () => {
  it('creates a case-insensitive regex for safe patterns', () => {
    expect(createSafeSearchRegex('report-[0-9]+').test('REPORT-2026')).toBe(true);
  });

  it.each(['(a+)+$', '(a|aa)+$', 'a*a*', '(?<x>a)\\k<x>', '(?=a)a'])(
    'rejects potentially expensive pattern %s',
    (pattern) => {
      expect(() => createSafeSearchRegex(pattern)).toThrow(UnsafeSearchRegexError);
    }
  );

  it('rejects invalid syntax and overly long patterns', () => {
    expect(() => createSafeSearchRegex('[')).toThrow(UnsafeSearchRegexError);
    expect(() => createSafeSearchRegex('a'.repeat(513))).toThrow(UnsafeSearchRegexError);
  });
});
