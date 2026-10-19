import { describe, expect, it } from 'vitest';
import { decodePreviewText } from './text-decode.js';

const opts = { key: 'file.txt', contentType: 'text/plain', truncated: false };

/** What the editor would send back on save: the text re-encoded as UTF-8. */
function saveBytes(decoded: { text: string; utf8Bom: boolean }): Uint8Array {
  return new TextEncoder().encode((decoded.utf8Bom ? '﻿' : '') + decoded.text);
}

describe('decodePreviewText', () => {
  it('decodes valid UTF-8 losslessly', () => {
    const bytes = new TextEncoder().encode('grüße – 日本語 🚀\n');
    const decoded = decodePreviewText(bytes, opts)!;

    expect(decoded.lossless).toBe(true);
    expect(saveBytes(decoded)).toEqual(bytes);
  });

  it('keeps a UTF-8 BOM so saving reproduces the original bytes', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('abc')]);
    const decoded = decodePreviewText(bytes, opts)!;

    expect(decoded.text).toBe('abc');
    expect(decoded.utf8Bom).toBe(true);
    expect(saveBytes(decoded)).toEqual(bytes);
  });

  it('marks a multi-byte character cut by truncation as not lossless', () => {
    const full = new TextEncoder().encode('ab€');
    const cut = full.slice(0, full.length - 1);
    const decoded = decodePreviewText(cut, { ...opts, truncated: true })!;

    expect(decoded.text).toBe('ab');
    expect(decoded.lossless).toBe(false);
  });

  it.each([
    ['UTF-16 LE', [0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]],
    ['UTF-16 BE', [0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]]
  ])('decodes %s for display but marks it as not lossless', (_name, raw) => {
    const decoded = decodePreviewText(new Uint8Array(raw), opts)!;

    expect(decoded.text).toBe('hi');
    expect(decoded.lossless).toBe(false);
  });

  it('marks the Windows-1252 CSV fallback as not lossless', () => {
    const decoded = decodePreviewText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), {
      ...opts,
      key: 'data.csv'
    })!;

    expect(decoded.text).toBe('café');
    expect(decoded.lossless).toBe(false);
  });

  it('returns null for invalid UTF-8 that is not text', () => {
    expect(decodePreviewText(new Uint8Array([0x00, 0xc3, 0x28, 0xff]), opts)).toBeNull();
  });
});
