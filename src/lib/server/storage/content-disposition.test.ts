import { describe, expect, it } from 'vitest';
import { contentDispositionFilename } from './content-disposition.js';

describe('download filename headers', () => {
  it('escapes disposition delimiters and encodes Unicode and RFC 5987 reserved characters', () => {
    const header = contentDispositionFilename('中😀a";x="y\\\r\n\'()*.txt');
    const response = new Response(null, { headers: { 'Content-Disposition': header } });
    expect(response.headers.get('Content-Disposition')).toContain('a\\";x=\\"y\\\\');
    expect(header).toContain('%E4%B8%AD%F0%9F%98%80');
    expect(header).toContain('%27%28%29%2A');
    expect(header).not.toMatch(/[\r\n]/);
  });
});
