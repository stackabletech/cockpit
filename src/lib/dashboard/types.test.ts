import { describe, expect, it } from 'vitest';
import { bookmarkFormSchema, bookmarkHostname, bookmarksInDisplayOrder } from './types';

const urlSchema = bookmarkFormSchema.shape.url;

describe('bookmark URL validation', () => {
  it.each([
    'https://superset.data-prod.corp',
    'https://trino.default.svc.cluster.local:8443',
    'http://localhost:8080',
    'http://10.0.0.5:30443',
    'http://trino:8443',
    'http://[::1]:8080/ui'
  ])('accepts %s', (url) => {
    expect(urlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://files.example.com',
    'superset.corp',
    'http://'
  ])('rejects %s', (url) => {
    expect(urlSchema.safeParse(url).success).toBe(false);
  });
});

describe('bookmarkHostname', () => {
  it('returns the hostname without port or path', () => {
    expect(bookmarkHostname('https://superset.example.com:8443/dashboards?x=1')).toBe(
      'superset.example.com'
    );
  });

  it('returns the input unchanged when it is not a URL', () => {
    expect(bookmarkHostname('superset.example')).toBe('superset.example');
  });
});

describe('bookmarksInDisplayOrder', () => {
  const link = (id: string) => ({
    id,
    productId: 'custom',
    name: id,
    environment: '',
    url: 'https://example.com',
    pinned: false
  });

  it('lists global bookmarks before the user’s own', () => {
    const own = { ...link('own'), createdAt: '2026-10-27T10:00:00.000Z' };

    expect(bookmarksInDisplayOrder([link('global')], [own]).map((b) => b.id)).toEqual([
      'global',
      'own'
    ]);
  });

  it('lists only the global bookmarks when the user’s are unavailable', () => {
    expect(bookmarksInDisplayOrder([link('global')], null).map((b) => b.id)).toEqual(['global']);
  });
});
