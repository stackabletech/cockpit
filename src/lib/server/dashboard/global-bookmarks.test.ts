import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

import { parseGlobalBookmarks } from './global-bookmarks.js';

const json = (value: unknown) => JSON.stringify(value);

describe('parseGlobalBookmarks', () => {
  it('has no global bookmarks when the variable is unset or blank', () => {
    expect(parseGlobalBookmarks(undefined)).toEqual([]);
    expect(parseGlobalBookmarks('  ')).toEqual([]);
  });

  it('parses bookmarks, numbers their ids and defaults the optional fields', () => {
    const bookmarks = parseGlobalBookmarks(
      json([
        {
          productId: 'superset',
          name: 'Dashboards',
          environment: 'prod',
          url: 'https://superset.example.com',
          pinned: true
        },
        { productId: 'custom', name: 'Team Wiki', url: 'https://wiki.example.com' }
      ])
    );

    expect(bookmarks).toEqual([
      {
        id: 'global-0',
        productId: 'superset',
        name: 'Dashboards',
        environment: 'prod',
        url: 'https://superset.example.com',
        pinned: true
      },
      {
        id: 'global-1',
        productId: 'custom',
        name: 'Team Wiki',
        environment: '',
        url: 'https://wiki.example.com',
        pinned: false
      }
    ]);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseGlobalBookmarks('[{')).toThrow(/not valid JSON/);
  });

  it('rejects anything but an array', () => {
    expect(() => parseGlobalBookmarks(json({ name: 'Wiki' }))).toThrow(/is invalid/);
  });

  it.each([
    ['a non-HTTP URL', { url: 'javascript:alert(1)' }, 'url'],
    ['a missing name', { name: undefined }, 'name'],
    ['a name above the length limit', { name: 'x'.repeat(41) }, 'name'],
    ['a misspelt key', { pined: true }, 'pined']
  ])('rejects %s and names the entry and field', (_, override, field) => {
    const entry = { productId: 'custom', name: 'Wiki', url: 'https://wiki.example.com' };

    const parse = () => parseGlobalBookmarks(json([entry, { ...entry, ...override }]));

    expect(parse).toThrow('[1]');
    expect(parse).toThrow(field);
  });

  it('does not repeat the configured values in the error', () => {
    const url = 'ftp://user:secret@files.example.com';

    expect(() => parseGlobalBookmarks(json([{ productId: 'custom', name: 'Files', url }]))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret') })
    );
  });
});
