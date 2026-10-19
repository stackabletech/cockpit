import { describe, expect, it } from 'vitest';
import { isEditableTextObject, isTextContentType } from './text-content-type.js';

describe('isTextContentType', () => {
  it.each(['text/plain', 'text/csv', 'application/json', 'application/x-ndjson'])(
    'treats %s as text',
    (type) => expect(isTextContentType(type)).toBe(true)
  );

  it.each(['application/octet-stream', 'image/png', 'application/pdf'])(
    'does not treat %s as text',
    (type) => expect(isTextContentType(type)).toBe(false)
  );
});

describe('isEditableTextObject', () => {
  it.each([
    ['notes.txt', 'text/plain'],
    ['config.yaml', 'application/yaml'],
    ['data.json', 'application/json']
  ])('allows editing %s (%s)', (key, type) => expect(isEditableTextObject(key, type)).toBe(true));

  it.each([
    ['a.csv', 'text/plain'],
    ['a.TSV', 'text/plain'],
    ['a', 'text/csv'],
    ['a', 'application/csv'],
    ['a', 'text/tab-separated-values'],
    ['a.log', 'application/octet-stream']
  ])('does not allow editing %s (%s)', (key, type) =>
    expect(isEditableTextObject(key, type)).toBe(false)
  );
});
