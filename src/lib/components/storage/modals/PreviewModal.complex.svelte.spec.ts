import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import PreviewModal from './PreviewModal.svelte';

vi.mock('$app/paths', () => ({
  resolve: (path: string) => path
}));

const defaultProps = {
  open: true,
  bucket: faker.word.noun(),
  objectKey: 'path/to/document.txt'
};

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
  if (options.renderable === false) {
    headers['X-Preview-Renderable'] = 'false';
  }
  return new Response(body, { status: options.status ?? 200, headers });
}

function parquetNdjson(headers: string[], rows: unknown[][], totalRows: number): string {
  const lines: Array<Record<string, unknown>> = [{ t: 'h', h: headers, tr: totalRows }];
  for (let ci = 0; ci < headers.length; ci++) {
    lines.push({ t: 'c', n: headers[ci], v: rows.map((r) => r[ci]) });
  }
  lines.push({ t: 'd' });
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

describe('PreviewModal complex previews', () => {
  const fetchMock = vi.fn();

  beforeAll(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    fetchMock.mockResolvedValue(mockFetchResponse('Hello world'));
  });

  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  describe('parquet preview', () => {
    it('should render parquet preview when format header is parquet', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockFetchResponse(parquetNdjson(['col1', 'col2'], [['val1', 'val2']], 100), {
            contentType: 'application/json',
            format: 'parquet',
            truncated: false,
            totalSize: 5000,
            totalRows: 100
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.parquet' });
      await expect.element(page.getByText('file.parquet')).toBeInTheDocument();
      await expect.element(page.getByText('val1')).toBeInTheDocument();
    });

    it('should show row count badge when parquet is truncated', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockFetchResponse(parquetNdjson(['col1', 'col2'], [['val1', 'val2']], 10000), {
            contentType: 'application/json',
            format: 'parquet',
            truncated: true,
            totalSize: 50000,
            totalRows: 10000
          })
        )
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.parquet' });
      await expect.element(page.getByText('file.parquet')).toBeInTheDocument();
      await expect.element(page.getByText('val1')).toBeInTheDocument();
      await expect
        .element(page.getByRole('paragraph'))
        .toHaveTextContent(/showing first 1 of 10,000 rows/i);
    });

    it('should show row count badge when parquet is truncated with previewRows header', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse(parquetNdjson(['col1', 'col2'], [['val1', 'val2']], 10000), {
          contentType: 'application/json',
          format: 'parquet',
          truncated: true,
          totalSize: 50000,
          totalRows: 10000,
          previewRows: 500
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.parquet' });
      await expect.element(page.getByText('file.parquet')).toBeInTheDocument();
      await expect.element(page.getByText('val1')).toBeInTheDocument();
      await expect
        .element(page.getByRole('paragraph'))
        .toHaveTextContent(/showing first 1 of 10,000 rows/i);
    });
  });

  describe('image preview', () => {
    it('should render image preview for image content type', async () => {
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const blob = new Blob([pngBytes], { type: 'image/png' });
      fetchMock.mockResolvedValue(
        new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'X-Preview-Total-Size': '8192'
          }
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'images/photo.png' });
      await expect.element(page.getByText('photo.png')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });

    it('should render image preview for image/jpeg', async () => {
      const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const blob = new Blob([jpgBytes], { type: 'image/jpeg' });
      fetchMock.mockResolvedValue(
        new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'X-Preview-Total-Size': '4096'
          }
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'images/photo.jpg' });
      await expect.element(page.getByText('photo.jpg')).toBeInTheDocument();
    });
  });

  describe('PDF preview', () => {
    it('should render PDF preview for application/pdf', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      fetchMock.mockResolvedValue(
        new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'X-Preview-Total-Size': '16384'
          }
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'docs/report.pdf' });
      await expect.element(page.getByText('report.pdf')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });
  });

  describe('fallback preview', () => {
    it('should render fallback when X-Preview-Renderable is false', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse('', {
          contentType: 'application/zip',
          renderable: false
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'archive.zip' });
      await expect.element(page.getByText('archive.zip')).toBeInTheDocument();
    });

    it('should render fallback for binary content that fails UTF-8 decode', async () => {
      const binaryBytes = new Uint8Array([0x80, 0x81, 0x82, 0x83, 0xff, 0xfe, 0xfd]);
      const blob = new Blob([binaryBytes]);
      fetchMock.mockResolvedValue(
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
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.bin' });
      await expect.element(page.getByText('file.bin')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should show error when fetch fails', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));
      render(PreviewModal, defaultProps);
      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should show access denied for 403', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
      render(PreviewModal, defaultProps);
      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should show not found for 404', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
      render(PreviewModal, defaultProps);
      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should show generic error for other status codes', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Server is down' }), { status: 500 })
      );
      render(PreviewModal, defaultProps);
      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should handle non-JSON error response body', async () => {
      fetchMock.mockResolvedValue(new Response('Not JSON at all', { status: 500 }));
      render(PreviewModal, defaultProps);
      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });
  });
});
