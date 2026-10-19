import { describe, expect, it } from 'vitest';
import { bookmarkFormSchema } from './types';

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
