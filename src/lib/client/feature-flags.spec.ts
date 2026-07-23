import { describe, it, expect } from 'vitest';
import { parsePageSizes } from './feature-flags.js';

describe('parsePageSizes', () => {
  it('defaults to [25, 50, 100] when raw is undefined', () => {
    expect(parsePageSizes(undefined)).toEqual([25, 50, 100]);
  });

  it('defaults to [25, 50, 100] when raw is empty string', () => {
    expect(parsePageSizes('')).toEqual([25, 50, 100]);
  });

  it('parses comma-separated values', () => {
    expect(parsePageSizes('10,20,50')).toEqual([10, 20, 50]);
  });

  it('deduplicates values', () => {
    expect(parsePageSizes('25,50,25,100,50')).toEqual([25, 50, 100]);
  });

  it('sorts ascending', () => {
    expect(parsePageSizes('100,25,50')).toEqual([25, 50, 100]);
  });

  it('filters out non-positive integers', () => {
    expect(parsePageSizes('0,-5,10,abc,25')).toEqual([10, 25]);
  });

  it('trims whitespace around values', () => {
    expect(parsePageSizes(' 10 , 25 , 50 ')).toEqual([10, 25, 50]);
  });

  it('falls back when all values are filtered out', () => {
    expect(parsePageSizes('0,-1,abc')).toEqual([25, 50, 100]);
  });

  it('handles single value', () => {
    expect(parsePageSizes('42')).toEqual([42]);
  });
});
