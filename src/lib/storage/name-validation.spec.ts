import { describe, expect, it } from 'vitest';
import { objectNameError } from './name-validation.js';

const create = { prefix: '', folder: false };
const rename = { prefix: '', folder: false, singleSegment: true };

describe('objectNameError', () => {
  it('accepts valid names, including nested ones on create', () => {
    expect(objectNameError('report.csv', create)).toBeNull();
    expect(objectNameError('a/b/report.csv', create)).toBeNull();
    expect(objectNameError(' report.csv ', rename)).toBeNull();
  });

  it('requires a name', () => {
    expect(objectNameError('', create)).toBe('Enter a name.');
    expect(objectNameError('   ', rename)).toBe('Enter a name.');
  });

  it('explains invalid characters and relative segments', () => {
    for (const name of ['x?y', 'a<b', 'a\tb', '..', 'a/./b']) {
      expect(objectNameError(name, create)).toMatch(/without the characters/);
    }
  });

  it('refuses "/" on rename', () => {
    expect(objectNameError('a/b', rename)).toMatch(/single name without "\/"/);
  });

  it('only checks the folder against S3 limits', () => {
    expect(objectNameError('new.txt', { prefix: 'reports?2024/../', folder: false })).toBeNull();
    expect(objectNameError('new.txt', { prefix: 'tab\there/', folder: false })).toBeNull();
  });

  it('explains a name that makes the full key too long', () => {
    const prefix = 'a'.repeat(1020) + '/';
    expect(objectNameError('abc', { prefix, folder: false })).toBeNull();
    expect(objectNameError('abc', { prefix, folder: true })).toMatch(/too long/);
  });
});
