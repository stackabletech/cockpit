import { describe, it, expect } from 'vitest';
import {
  compileFilterPredicates,
  formatDateValue,
  isUsableFilter,
  parseDateInput,
  parseFilterParam,
  parseSizeInput,
  serializeFilter,
  FILTER_OPERATORS
} from './search-filter.js';

const MB = 1024 ** 2;

describe('parseSizeInput', () => {
  it('interprets bare numbers as megabytes', () => {
    expect(parseSizeInput('1')).toBe(1024 ** 2);
    expect(parseSizeInput('2')).toBe(2 * 1024 ** 2);
    expect(parseSizeInput('2048 ')).toBe(2048 * 1024 ** 2);
  });

  it('accepts dot and comma decimal separators', () => {
    expect(parseSizeInput('1.5')).toBe(1.5 * MB);
    expect(parseSizeInput('1,5')).toBe(1.5 * MB);
    expect(parseSizeInput('2.5')).toBe(2.5 * MB);
  });

  it('accepts an explicit MB suffix (case insensitive)', () => {
    expect(parseSizeInput('2.5 MB')).toBe(2.5 * MB);
    expect(parseSizeInput('2.5mb')).toBe(2.5 * MB);
    expect(parseSizeInput('3 MiB')).toBe(3 * MB);
    expect(parseSizeInput('4 M')).toBe(4 * MB);
  });

  it('rejects other unit suffixes — sizes are always MB', () => {
    expect(parseSizeInput('1 KB')).toBeNull();
    expect(parseSizeInput('1 GB')).toBeNull();
    expect(parseSizeInput('1 TB')).toBeNull();
    expect(parseSizeInput('3 seConds')).toBeNull();
  });

  it('rejects malformed values', () => {
    expect(parseSizeInput('abc')).toBeNull();
    expect(parseSizeInput('1.2.3')).toBeNull();
    expect(parseSizeInput('-5')).toBeNull();
    expect(parseSizeInput('1.5 blerg')).toBeNull();
  });
});

describe('parseDateInput', () => {
  it('parses ISO year-first notation', () => {
    expect(parseDateInput('2026-08-17')).toEqual(new Date(2026, 7, 17));
    expect(parseDateInput('2026/08/17')).toEqual(new Date(2026, 7, 17));
    expect(parseDateInput('2026.08.17')).toEqual(new Date(2026, 7, 17));
  });

  it('parses European day-first notation', () => {
    expect(parseDateInput('17.08.2026')).toEqual(new Date(2026, 7, 17));
    expect(parseDateInput('17/08/2026')).toEqual(new Date(2026, 7, 17));
    expect(parseDateInput('17-08-2026')).toEqual(new Date(2026, 7, 17));
  });

  it('parses US month-first notation and day-first when forced', () => {
    expect(parseDateInput('08/17/2026')).toEqual(new Date(2026, 7, 17));
    expect(parseDateInput('08/17/2026', { preferDayFirst: true })).toEqual(new Date(2026, 7, 17));
    expect(parseDateInput('08-17-2026')).toEqual(new Date(2026, 7, 17));
  });

  it('assumes day-first for ambiguous values by default', () => {
    expect(parseDateInput('02/03/2026')).toEqual(new Date(2026, 2, 2));
    expect(parseDateInput('02/03/2026', { preferDayFirst: false })).toEqual(new Date(2026, 1, 3));
  });

  it('accepts an optional time component', () => {
    expect(parseDateInput('17.08.2026 14:30')).toEqual(new Date(2026, 7, 17, 14, 30));
    expect(parseDateInput('2026-08-17T09:05:30')).toEqual(new Date(2026, 7, 17, 9, 5, 30));
  });

  it('rejects invalid dates', () => {
    expect(parseDateInput('30.02.2026')).toBeNull();
    expect(parseDateInput('abc')).toBeNull();
    expect(parseDateInput('2026-13-01')).toBeNull();
    expect(parseDateInput('32.01.2026')).toBeNull();
    expect(parseDateInput('2026-08-17 25:00')).toBeNull();
    expect(parseDateInput('17.08.2026 10:99')).toBeNull();
  });
});

describe('formatDateValue', () => {
  it('formats local time to YYYY-MM-DD', () => {
    expect(formatDateValue(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('serialise / parse filter params', () => {
  it('round-trips a filter', () => {
    const spec = { field: 'date' as const, operator: '>' as const, value: '17.08.2026' };
    expect(parseFilterParam(serializeFilter(spec))).toEqual(spec);
  });

  it('parses size filters', () => {
    expect(parseFilterParam('size<1.5GB')).toEqual({
      field: 'size',
      operator: '<',
      value: '1.5GB'
    });
  });

  it('rejects malformed params', () => {
    expect(parseFilterParam('nonsense')).toBeNull();
    expect(parseFilterParam('datetime>2026-01-01')).toBeNull();
    expect(parseFilterParam('date**2026')).toBeNull();
  });

  it('exposes the default operator first', () => {
    expect(FILTER_OPERATORS).toEqual(['>', '=', '<']);
  });
});

describe('isUsableFilter', () => {
  it('accepts parseable values and rejects empty or invalid ones', () => {
    expect(isUsableFilter({ field: 'size', operator: '>', value: '1 MB' })).toBe(true);
    expect(isUsableFilter({ field: 'date', operator: '<', value: '01.02.2026' })).toBe(true);
    expect(isUsableFilter({ field: 'size', operator: '>', value: '' })).toBe(false);
    expect(isUsableFilter({ field: 'date', operator: '>', value: 'not a date' })).toBe(false);
  });
});

describe('compileFilterPredicates', () => {
  const item = (size: number, lastModified: Date) => ({ size, lastModified });

  it('returns a pass-through when no usable filters exist', () => {
    const predicate = compileFilterPredicates([{ field: 'size', operator: '>', value: '' }]);
    expect(predicate(item(1, new Date()))).toBe(true);
  });

  it('filters by size', () => {
    const predicate = compileFilterPredicates([{ field: 'size', operator: '>', value: '1' }]);
    expect(predicate(item(2 * MB, new Date()))).toBe(true);
    expect(predicate(item(MB / 2, new Date()))).toBe(false);
  });

  it('filters by exact size', () => {
    const predicate = compileFilterPredicates([{ field: 'size', operator: '=', value: '1' }]);
    expect(predicate(item(MB, new Date()))).toBe(true);
    expect(predicate(item(MB + 1, new Date()))).toBe(false);
  });

  it('excludes directories while a size filter is active', () => {
    const predicate = compileFilterPredicates([{ field: 'size', operator: '<', value: '2' }]);
    expect(predicate({ size: MB, lastModified: new Date(), isDirectory: false })).toBe(true);
    expect(predicate({ size: 0, lastModified: new Date(), isDirectory: true })).toBe(false);
  });

  it('date "=" matches the whole day', () => {
    const predicate = compileFilterPredicates([
      { field: 'date', operator: '=', value: '17.08.2026' }
    ]);
    expect(predicate(item(1, new Date(2026, 7, 17, 0, 0, 0)))).toBe(true);
    expect(predicate(item(1, new Date(2026, 7, 17, 23, 59, 59)))).toBe(true);
    expect(predicate(item(1, new Date(2026, 7, 16, 23, 59, 59)))).toBe(false);
    expect(predicate(item(1, new Date(2026, 7, 18, 0, 0, 0)))).toBe(false);
  });

  it('date ">" matches days strictly after the given day', () => {
    const predicate = compileFilterPredicates([
      { field: 'date', operator: '>', value: '2026-08-17' }
    ]);
    expect(predicate(item(1, new Date(2026, 7, 18, 0, 0, 0)))).toBe(true);
    expect(predicate(item(1, new Date(2026, 7, 17, 23, 59, 59)))).toBe(false);
  });

  it('date "<" matches days strictly before the given day', () => {
    const predicate = compileFilterPredicates([
      { field: 'date', operator: '<', value: '17.08.2026' }
    ]);
    expect(predicate(item(1, new Date(2026, 7, 17, 0, 0, 0)))).toBe(false);
    expect(predicate(item(1, new Date(2026, 7, 16, 23, 59, 59)))).toBe(true);
  });

  it('combines multiple filters with logical AND', () => {
    const predicate = compileFilterPredicates([
      { field: 'size', operator: '>', value: '1' },
      { field: 'date', operator: '<', value: '01.01.2026' }
    ]);
    expect(predicate(item(2 * MB, new Date(2025, 11, 31, 23, 59)))).toBe(true);
    expect(predicate(item(2 * MB, new Date(2026, 0, 2)))).toBe(false);
    expect(predicate(item(MB / 2, new Date(2025, 11, 31)))).toBe(false);
  });
});
