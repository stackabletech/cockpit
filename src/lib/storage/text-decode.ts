import { isTextContentType } from './text-content-type.js';

/** Result of decoding a text preview. */
export interface DecodedText {
  /** Text to display (a leading UTF-8 byte order mark is stripped). */
  text: string;
  /**
   * True only when the bytes are valid UTF-8, so encoding `text` as UTF-8
   * (with the BOM restored when `utf8Bom` is set) reproduces them exactly.
   * Only such content may be saved back.
   */
  lossless: boolean;
  /** The bytes started with a UTF-8 byte order mark. */
  utf8Bom: boolean;
}

/**
 * Decode preview bytes for display. Returns `null` for content that should be
 * treated as binary. Anything that is not strictly valid UTF-8 (UTF-16 with a
 * BOM, Windows-1252 CSV, a multi-byte character cut by truncation) is decoded
 * best-effort and marked as not `lossless`.
 */
export function decodePreviewText(
  bytes: Uint8Array,
  opts: { key: string; contentType: string; truncated: boolean }
): DecodedText | null {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(bytes), lossless: false, utf8Bom: false };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(bytes), lossless: false, utf8Bom: false };
    }
  }

  try {
    const utf8Bom =
      bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      lossless: true,
      utf8Bom
    };
  } catch {
    // If the content was truncated, the invalid bytes might be at the
    // truncation boundary (a multi-byte character cut in half). Decode
    // without fatal and strip trailing replacement characters.
    // Only do this for text-like content types — binary files should
    // fall through to the FallbackPreview.
    if (opts.truncated && isTextContentType(opts.contentType)) {
      const text = new TextDecoder('utf-8').decode(bytes).replace(/�+$/, '');
      return { text, lossless: false, utf8Bom: false };
    }

    // For CSV/TSV files try Windows-1252 — the default encoding used by
    // Excel on Windows when exporting to CSV.
    const lowerKey = opts.key.toLowerCase();
    if (lowerKey.endsWith('.csv') || lowerKey.endsWith('.tsv')) {
      return {
        text: new TextDecoder('windows-1252').decode(bytes),
        lossless: false,
        utf8Bom: false
      };
    }
    return null;
  }
}
