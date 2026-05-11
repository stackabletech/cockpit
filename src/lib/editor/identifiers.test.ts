import { describe, it, expect } from 'vitest';
import { unquoteIdentifier, SIMPLE_IDENTIFIER_REGEX } from './identifiers';

describe('unquoteIdentifier', () => {
  it('leaves unquoted identifiers alone', () => {
    expect(unquoteIdentifier('foo')).toBe('foo');
    expect(unquoteIdentifier('foo_bar')).toBe('foo_bar');
  });

  it('strips double quotes', () => {
    expect(unquoteIdentifier('"foo"')).toBe('foo');
  });

  it('strips backticks', () => {
    expect(unquoteIdentifier('`foo`')).toBe('foo');
  });

  it('collapses doubled double-quotes (SQL escape)', () => {
    expect(unquoteIdentifier('"foo""bar"')).toBe('foo"bar');
  });

  it('collapses doubled backticks', () => {
    expect(unquoteIdentifier('`foo``bar`')).toBe('foo`bar');
  });

  it('handles empty quoted strings', () => {
    expect(unquoteIdentifier('""')).toBe('');
    expect(unquoteIdentifier('``')).toBe('');
  });

  it('does not strip mismatched quotes', () => {
    expect(unquoteIdentifier('"foo')).toBe('"foo');
    expect(unquoteIdentifier('foo"')).toBe('foo"');
    expect(unquoteIdentifier('`foo"')).toBe('`foo"');
  });
});

describe('SIMPLE_IDENTIFIER_REGEX', () => {
  it('matches valid simple identifiers', () => {
    expect(SIMPLE_IDENTIFIER_REGEX.test('foo')).toBe(true);
    expect(SIMPLE_IDENTIFIER_REGEX.test('foo123')).toBe(true);
    expect(SIMPLE_IDENTIFIER_REGEX.test('foo_bar')).toBe(true);
    expect(SIMPLE_IDENTIFIER_REGEX.test('_foo')).toBe(true);
  });

  it('rejects identifiers with special characters', () => {
    expect(SIMPLE_IDENTIFIER_REGEX.test('foo-bar')).toBe(false);
    expect(SIMPLE_IDENTIFIER_REGEX.test('foo.bar')).toBe(false);
    expect(SIMPLE_IDENTIFIER_REGEX.test('foo bar')).toBe(false);
    expect(SIMPLE_IDENTIFIER_REGEX.test('"foo"')).toBe(false);
  });
});
