import { describe, it, expect } from 'vitest';
import { KNOWN_BINARY_TYPES, binaryPreview } from './binary.js';

describe('KNOWN_BINARY_TYPES', () => {
  it('contains gzip', () => {
    expect(KNOWN_BINARY_TYPES.has('application/gzip')).toBe(true);
  });

  it('contains zip', () => {
    expect(KNOWN_BINARY_TYPES.has('application/zip')).toBe(true);
  });

  it('does not contain text/plain', () => {
    expect(KNOWN_BINARY_TYPES.has('text/plain')).toBe(false);
  });
});

describe('binaryPreview', () => {
  it('returns response with correct headers', () => {
    const res = binaryPreview('application/gzip', 12345);
    expect(res.headers.get('Content-Type')).toBe('application/gzip');
    expect(res.headers.get('X-Preview-Renderable')).toBe('false');
    expect(res.headers.get('X-Preview-Total-Size')).toBe('12345');
    expect(res.headers.get('X-Preview-Bytes')).toBe('0');
    expect(res.headers.get('X-Preview-Truncated')).toBe('false');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns null body', async () => {
    const res = binaryPreview('application/zip', 0);
    expect(res.body).toBeNull();
  });
});
