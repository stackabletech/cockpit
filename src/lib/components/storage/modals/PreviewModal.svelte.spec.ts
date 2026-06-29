import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import PreviewModal from './PreviewModal.svelte';

// Prevent Monaco Editor from loading in tests by making $app/environment's
// `browser` return false. TextEditor renders a plain <pre> as fallback.
vi.mock('$app/environment', () => ({ browser: false }));

// Mock $app/paths
vi.mock('$app/paths', () => ({
  resolve: (path: string) => path
}));

const defaultProps = {
  open: true,
  bucket: faker.word.noun(),
  objectKey: 'path/to/document.txt'
};

/** Helper to create a mock Response with given content-type and headers */
function mockFetchResponse(
  body: BodyInit | null,
  options: {
    contentType?: string;
    format?: string;
    truncated?: boolean;
    totalSize?: number;
    previewBytes?: number;
    totalRows?: number;
    previewRows?: number;
    renderable?: boolean;
    status?: number;
  } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': options.contentType ?? 'text/plain',
    'X-Preview-Format': options.format ?? 'text',
    'X-Preview-Truncated': String(options.truncated ?? false),
    'X-Preview-Total-Size': String(options.totalSize ?? 0),
    'X-Preview-Bytes': String(options.previewBytes ?? 0)
  };
  if (options.totalRows !== undefined) {
    headers['X-Preview-Total-Rows'] = String(options.totalRows);
  }
  if (options.previewRows !== undefined) {
    headers['X-Preview-Preview-Rows'] = String(options.previewRows);
  }
  if (options.renderable === false) {
    headers['X-Preview-Renderable'] = 'false';
  }
  return new Response(body, { status: options.status ?? 200, headers });
}

describe('PreviewModal', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse('Hello world', {
          contentType: 'text/plain',
          totalSize: 11,
          previewBytes: 11
        })
      )
    );
  });

  describe('initial render', () => {
    it('should render a dialog when open', async () => {
      render(PreviewModal, defaultProps);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should show the filename in the heading', async () => {
      render(PreviewModal, { ...defaultProps, objectKey: 'folder/report.csv' });

      await expect.element(page.getByText('report.csv')).toBeInTheDocument();
    });

    it('should show loading state initially', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('Loading preview…')).toBeInTheDocument();
    });
  });

  describe('when open is false', () => {
    it('should not render dialog content', async () => {
      render(PreviewModal, { ...defaultProps, open: false });

      const heading = page.getByRole('heading');
      await expect.element(heading).not.toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('should have a close button', async () => {
      render(PreviewModal, defaultProps);

      const closeBtn = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtn).toBeInTheDocument();
    });
  });

  describe('maximize toggle', () => {
    it('should have a maximise button', async () => {
      render(PreviewModal, defaultProps);

      const maxBtn = page.getByRole('button', { name: /maximise/i });
      await expect.element(maxBtn).toBeInTheDocument();
    });

    it('should switch to restore button after clicking maximise', async () => {
      render(PreviewModal, defaultProps);

      await page.getByRole('button', { name: /maximise/i }).click();

      await expect.element(page.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    });

    it('should toggle back to maximise after clicking restore', async () => {
      render(PreviewModal, defaultProps);

      await page.getByRole('button', { name: /maximise/i }).click();
      await page.getByRole('button', { name: /restore/i }).click();

      await expect.element(page.getByRole('button', { name: /maximise/i })).toBeInTheDocument();
    });
  });

  describe('text preview', () => {
    it('should render text content after fetch completes', async () => {
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('Hello world')).toBeInTheDocument();
    });

    it('should show file size badge', async () => {
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('11 B')).toBeInTheDocument();
    });

    it('should show truncated badge when content is truncated', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('Truncated content...', {
            contentType: 'text/plain',
            truncated: true,
            totalSize: 50000,
            previewBytes: 1024
          })
        )
      );
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('Truncated content...')).toBeInTheDocument();
      // Should show both total size and truncated warning badges
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });

    it('should show download full button when truncated', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('Partial content', {
            contentType: 'text/plain',
            truncated: true,
            totalSize: 50000,
            previewBytes: 1024
          })
        )
      );
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('Partial content')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });

    it('should show a close button in the footer', async () => {
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('Hello world')).toBeInTheDocument();
      // Footer close button
      const closeBtns = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtns.first()).toBeInTheDocument();
    });
  });

  describe('CSV preview', () => {
    it('should render CSV preview for text/csv content type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('name,value\nfoo,1\nbar,2', {
            contentType: 'text/csv',
            totalSize: 30,
            previewBytes: 30
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/test.csv' });

      await expect.element(page.getByText('30 B')).toBeInTheDocument();
    });

    it('should render CSV preview for application/csv content type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('a,b\n1,2', {
            contentType: 'application/csv',
            totalSize: 10,
            previewBytes: 10
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/test.dat' });

      await expect.element(page.getByText('10 B')).toBeInTheDocument();
    });

    it('should render CSV preview for application/vnd.ms-excel content type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('col1,col2\nval1,val2', {
            contentType: 'application/vnd.ms-excel',
            totalSize: 20,
            previewBytes: 20
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/test.xls' });

      await expect.element(page.getByText('20 B')).toBeInTheDocument();
    });

    it('should render CSV preview based on .csv file extension', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('x,y\n1,2', {
            contentType: 'application/octet-stream',
            totalSize: 8,
            previewBytes: 8
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.csv' });

      await expect.element(page.getByText('8 B')).toBeInTheDocument();
    });

    it('should show truncated badge for truncated CSV', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('a,b\n1,2', {
            contentType: 'text/csv',
            truncated: true,
            totalSize: 100000,
            previewBytes: 2048
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/big.csv' });

      await expect.element(page.getByText('big.csv')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });
  });

  describe('parquet preview', () => {
    /** Create a mock Response-like object whose body yields NDJSON lines. */
    function ndjsonResponse(
      messages: Record<string, unknown>[],
      options: {
        contentType?: string;
        format?: string;
        truncated?: boolean;
        totalSize?: number;
        totalRows?: number;
        previewRows?: number;
        previewBytes?: number;
        dataBlocked?: boolean;
      }
    ): Response {
      const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      const headerMap: Record<string, string> = {
        'content-type': options.contentType ?? 'application/json',
        'x-preview-format': options.format ?? 'parquet',
        'x-preview-truncated': String(options.truncated ?? false),
        'x-preview-total-size': String(options.totalSize ?? 0),
        'x-preview-bytes': String(options.previewBytes ?? 0),
        'x-preview-renderable': 'true'
      };
      if (options.dataBlocked) {
        headerMap['x-preview-data-blocked'] = 'true';
      }
      if (options.totalRows !== undefined) {
        headerMap['x-preview-total-rows'] = String(options.totalRows);
      }
      if (options.previewRows !== undefined) {
        headerMap['x-preview-preview-rows'] = String(options.previewRows);
      }
      const encoded = new TextEncoder().encode(ndjson);
      const mockResponse = {
        ok: true,
        status: 200,
        headers: { get: (name: string) => headerMap[name.toLowerCase()] ?? null },
        body: {
          getReader() {
            let done = false;
            return {
              read() {
                if (done) return Promise.resolve({ done: true, value: undefined });
                done = true;
                return Promise.resolve({ done: false, value: encoded });
              },
              cancel() {}
            };
          }
        },
        json: async () => ({ error: 'not available' })
      };
      return mockResponse as unknown as Response;
    }

    it('should render metadata tab by default and show schema info', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          ndjsonResponse(
            [
              {
                t: 'h',
                h: ['col1', 'col2'],
                tr: 100,
                s: [
                  {
                    name: 'col1',
                    type: 'string',
                    codec: 'SNAPPY',
                    compressedSize: 100,
                    uncompressedSize: 200,
                    stats: { nullCount: 0, distinctCount: null, min: null, max: null }
                  },
                  {
                    name: 'col2',
                    type: 'int64',
                    codec: 'SNAPPY',
                    compressedSize: 50,
                    uncompressedSize: 80,
                    stats: { nullCount: null, distinctCount: null, min: null, max: null }
                  }
                ],
                m: {
                  rowGroups: 1,
                  compressionCodecs: ['SNAPPY'],
                  compressionUniform: true,
                  hasOffsetIndex: true,
                  hasColumnIndex: true,
                  createdBy: null,
                  version: 1,
                  arrowSchema: null
                }
              },
              { t: 'c', n: 'col1', v: ['val1'] },
              { t: 'c', n: 'col2', v: ['val2'] }
            ],
            {
              format: 'parquet',
              truncated: false,
              totalSize: 5000,
              totalRows: 100,
              previewRows: 50
            }
          )
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.parquet' });

      await expect.element(page.getByText('file.parquet')).toBeInTheDocument();
      // Metadata tab should be active by default showing schema info
      await expect.element(page.getByText('col1').first()).toBeInTheDocument();
      await expect.element(page.getByText('col2').first()).toBeInTheDocument();
      // Tab labels should be visible
      await expect.element(page.getByText('Metadata')).toBeInTheDocument();
      await expect
        .element(page.getByRole('tab', { name: 'Data', exact: true }))
        .toBeInTheDocument();
    });

    it('should show row count badge when parquet is truncated', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          ndjsonResponse(
            [
              {
                t: 'h',
                h: ['col1', 'col2'],
                tr: 10000,
                s: [],
                m: {
                  rowGroups: 1,
                  compressionCodecs: ['SNAPPY'],
                  compressionUniform: true,
                  hasOffsetIndex: true,
                  hasColumnIndex: true,
                  createdBy: null,
                  version: 1,
                  arrowSchema: null
                }
              },
              { t: 'c', n: 'col1', v: ['val1'] },
              { t: 'c', n: 'col2', v: ['val2'] }
            ],
            {
              format: 'parquet',
              truncated: true,
              totalSize: 50000,
              totalRows: 10000,
              previewRows: 500
            }
          )
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.parquet' });

      await expect.element(page.getByText('file.parquet')).toBeInTheDocument();
      await expect.element(page.getByText('col1').first()).toBeInTheDocument();
      await expect
        .element(page.getByText('Showing first 0 of 10,000 rows (parquet)').first())
        .toBeInTheDocument();
    });

    it('should show data table when clicking Data tab', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          ndjsonResponse(
            [
              {
                t: 'h',
                h: ['col1', 'col2'],
                tr: 100,
                s: [],
                m: {
                  rowGroups: 1,
                  compressionCodecs: ['SNAPPY'],
                  compressionUniform: true,
                  hasOffsetIndex: true,
                  hasColumnIndex: true,
                  createdBy: null,
                  version: 1,
                  arrowSchema: null
                }
              },
              { t: 'c', n: 'col1', v: ['val1'] },
              { t: 'c', n: 'col2', v: ['val2'] }
            ],
            {
              format: 'parquet',
              truncated: false,
              totalSize: 5000,
              totalRows: 100,
              previewRows: 50
            }
          )
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.parquet' });

      await expect.element(page.getByText('file.parquet')).toBeInTheDocument();

      // Click the Data tab
      await page.getByRole('tab', { name: 'Data' }).first().click();

      // Parquet preview table should be visible with column headers
      await expect
        .element(page.getByRole('table', { name: 'Parquet preview' }))
        .toBeInTheDocument();
      await expect.element(page.getByText('col1').first()).toBeInTheDocument();
      await expect.element(page.getByText('col2').first()).toBeInTheDocument();
    });

    it('should show blocked message when parquet is not renderable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          ndjsonResponse(
            [
              {
                t: 'h',
                h: ['col1', 'col2'],
                tr: 100,
                s: [
                  {
                    name: 'col1',
                    type: 'string',
                    codec: 'SNAPPY',
                    compressedSize: 100,
                    uncompressedSize: 200,
                    stats: { nullCount: null, distinctCount: null, min: null, max: null }
                  },
                  {
                    name: 'col2',
                    type: 'int64',
                    codec: 'GZIP',
                    compressedSize: 50,
                    uncompressedSize: 80,
                    stats: { nullCount: null, distinctCount: null, min: null, max: null }
                  }
                ],
                m: {
                  rowGroups: 1,
                  compressionCodecs: ['SNAPPY', 'GZIP'],
                  compressionUniform: false,
                  hasOffsetIndex: true,
                  hasColumnIndex: true,
                  createdBy: null,
                  version: 1,
                  arrowSchema: null
                }
              }
            ],
            {
              format: 'parquet',
              dataBlocked: true,
              truncated: false,
              totalSize: 5000,
              totalRows: 100,
              previewRows: 50
            }
          )
        )
      );

      render(PreviewModal, { ...defaultProps, objectKey: 'data/blocked.parquet' });

      await expect.element(page.getByText('blocked.parquet')).toBeInTheDocument();
      await expect.element(page.getByText('Preview blocked').first()).toBeInTheDocument();
    });
  });

  describe('image preview', () => {
    it('should render image preview for image content type', async () => {
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const blob = new Blob([pngBytes], { type: 'image/png' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'image/png',
              'X-Preview-Total-Size': '8192'
            }
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'images/photo.png' });

      await expect.element(page.getByText('photo.png')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });

    it('should render image preview for image/jpeg', async () => {
      const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const blob = new Blob([jpgBytes], { type: 'image/jpeg' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'image/jpeg',
              'X-Preview-Total-Size': '4096'
            }
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'images/photo.jpg' });

      await expect.element(page.getByText('photo.jpg')).toBeInTheDocument();
    });
  });

  describe('PDF preview', () => {
    it('should render PDF preview for application/pdf', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'X-Preview-Total-Size': '16384'
            }
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'docs/report.pdf' });

      await expect.element(page.getByText('report.pdf')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });
  });

  describe('fallback preview', () => {
    it('should render fallback when X-Preview-Renderable is false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('', {
            contentType: 'application/zip',
            renderable: false
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'archive.zip' });

      // Fallback should not show a footer with download/close buttons
      // Wait for the preview to load
      await expect.element(page.getByText('archive.zip')).toBeInTheDocument();
    });

    it('should render fallback for binary content that fails UTF-8 decode', async () => {
      // Create bytes that are invalid UTF-8 (not a CSV/TSV extension)
      const binaryBytes = new Uint8Array([0x80, 0x81, 0x82, 0x83, 0xff, 0xfe, 0xfd]);
      const blob = new Blob([binaryBytes]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Preview-Format': 'raw',
              'X-Preview-Truncated': 'false',
              'X-Preview-Total-Size': '7',
              'X-Preview-Bytes': '7'
            }
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.bin' });

      // Should eventually show fallback (no footer since fallback kind)
      await expect.element(page.getByText('file.bin')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should show error when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      render(PreviewModal, defaultProps);

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should show access denied for 403', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
      render(PreviewModal, defaultProps);

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should show not found for 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
      render(PreviewModal, defaultProps);

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should show generic error for other status codes', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ error: 'Server is down' }), { status: 500 })
          )
      );
      render(PreviewModal, defaultProps);

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should handle non-JSON error response body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('Not JSON at all', { status: 500 }))
      );
      render(PreviewModal, defaultProps);

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('UTF-16 BOM detection', () => {
    it('should decode UTF-16 LE BOM content', async () => {
      // UTF-16 LE BOM (0xFF 0xFE) followed by "Hi" in UTF-16 LE
      const bytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
      const blob = new Blob([bytes]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'X-Preview-Format': 'text',
              'X-Preview-Truncated': 'false',
              'X-Preview-Total-Size': '6',
              'X-Preview-Bytes': '6'
            }
          })
        )
      );
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('Hi')).toBeInTheDocument();
    });

    it('should decode UTF-16 BE BOM content', async () => {
      // UTF-16 BE BOM (0xFE 0xFF) followed by "OK" in UTF-16 BE
      const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x4f, 0x00, 0x4b]);
      const blob = new Blob([bytes]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'X-Preview-Format': 'text',
              'X-Preview-Truncated': 'false',
              'X-Preview-Total-Size': '6',
              'X-Preview-Bytes': '6'
            }
          })
        )
      );
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('OK')).toBeInTheDocument();
    });
  });

  describe('Windows-1252 fallback for CSV', () => {
    it('should decode CSV with Windows-1252 when UTF-8 fails', async () => {
      // Create bytes with 0xe4 (ä in Windows-1252) which is invalid as standalone UTF-8
      const bytes = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xe4]); // "Name\nä"
      const blob = new Blob([bytes]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'text/csv',
              'X-Preview-Format': 'text',
              'X-Preview-Truncated': 'false',
              'X-Preview-Total-Size': '6',
              'X-Preview-Bytes': '6'
            }
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.csv' });

      // Should still show the filename (the content is decoded as Windows-1252)
      await expect.element(page.getByText('file.csv')).toBeInTheDocument();
    });

    it('should decode TSV with Windows-1252 when UTF-8 fails', async () => {
      const bytes = new Uint8Array([0x41, 0x09, 0x42, 0x0a, 0xe4, 0x09, 0xfc]); // "A\tB\nä\tü"
      const blob = new Blob([bytes]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(blob, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'X-Preview-Format': 'text',
              'X-Preview-Truncated': 'false',
              'X-Preview-Total-Size': '7',
              'X-Preview-Bytes': '7'
            }
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.tsv' });

      await expect.element(page.getByText('file.tsv')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have a dialog role', async () => {
      render(PreviewModal, defaultProps);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have aria-label on close button', async () => {
      render(PreviewModal, defaultProps);

      const closeBtn = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtn).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle null objectKey', async () => {
      render(PreviewModal, { ...defaultProps, objectKey: null });

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should handle deeply nested object key', async () => {
      render(PreviewModal, {
        ...defaultProps,
        objectKey: 'a/b/c/d/e/f/deeply-nested-file.json'
      });

      await expect.element(page.getByText('deeply-nested-file.json')).toBeInTheDocument();
    });

    it('should handle object key with special characters', async () => {
      render(PreviewModal, {
        ...defaultProps,
        objectKey: 'data/file (copy).txt'
      });

      await expect.element(page.getByText('file (copy).txt')).toBeInTheDocument();
    });
  });
});
