/** Encode an untrusted object filename for an HTTP attachment response. */
export function contentDispositionFilename(filename: string): string {
  const quoted = filename
    .replace(/[\r\n]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/(["\\])/g, '\\$1');
  const encoded = encodeURIComponent(filename.toWellFormed()).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encoded}`;
}
