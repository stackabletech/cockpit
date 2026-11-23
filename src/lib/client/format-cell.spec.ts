import { describe, expect, it } from 'vitest';
import { formatCell } from './format-cell';

describe('formatCell', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    ['text', 'text'],
    [42, '42'],
    [false, 'false'],
    [12n, '12'],
    [{ a: 1 }, '{"a":1}'],
    [Symbol('s'), '']
  ])('formats %o as %s', (value, expected) => {
    expect(formatCell(value)).toBe(expected);
  });
});
