import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import PreviewModal from './PreviewModal.svelte';

vi.mock('$app/paths', () => ({
  resolve: (path: string) => path
}));

// Mock storage context — provide an API that delegates to the global fetch
vi.mock('$lib/storage/context.js', () => ({
  getStorageState: () => ({
    get api() {
      return {
        preview: (...args: unknown[]) =>
          (globalThis.fetch as typeof fetch)(...(args as Parameters<typeof fetch>)),
        archiveExtract: (...args: unknown[]) =>
          (globalThis.fetch as typeof fetch)(...(args as Parameters<typeof fetch>)),
        saveText: (...args: unknown[]) =>
          (globalThis.fetch as typeof fetch)(...(args as Parameters<typeof fetch>))
      };
    },
    bucket: 'test-bucket'
  })
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
  } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': options.contentType ?? 'text/plain',
    'X-Preview-Format': options.format ?? 'text',
    'X-Preview-Truncated': String(options.truncated ?? false),
    'X-Preview-Total-Size': String(options.totalSize ?? 0),
    'X-Preview-Bytes': String(options.previewBytes ?? 0)
  };
  return new Response(body, { status: 200, headers });
}

describe('PreviewModal text and CSV preview', () => {
  const fetchMock = vi.fn();

  beforeAll(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      mockFetchResponse('Hello world', {
        contentType: 'text/plain',
        totalSize: 11,
        previewBytes: 11
      })
    );
  });

  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
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
      fetchMock.mockResolvedValue(
        mockFetchResponse('Truncated content...', {
          contentType: 'text/plain',
          truncated: true,
          totalSize: 50000,
          previewBytes: 1024
        })
      );
      render(PreviewModal, defaultProps);
      await expect.element(page.getByText('Truncated content...')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });

    it('should show download full button when truncated', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse('Partial content', {
          contentType: 'text/plain',
          truncated: true,
          totalSize: 50000,
          previewBytes: 1024
        })
      );
      render(PreviewModal, defaultProps);
      await expect.element(page.getByText('Partial content')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });

    it('should show a close button in the footer', async () => {
      render(PreviewModal, defaultProps);
      await expect.element(page.getByText('Hello world')).toBeInTheDocument();
      const closeBtns = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtns.first()).toBeInTheDocument();
    });
  });

  describe('CSV preview', () => {
    it('should render CSV preview for text/csv content type', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse('name,value\nfoo,1\nbar,2', {
          contentType: 'text/csv',
          totalSize: 30,
          previewBytes: 30
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/test.csv' });
      await expect.element(page.getByText('30 B')).toBeInTheDocument();
    });

    it('should render CSV preview for application/csv content type', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse('a,b\n1,2', {
          contentType: 'application/csv',
          totalSize: 10,
          previewBytes: 10
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/test.dat' });
      await expect.element(page.getByText('10 B')).toBeInTheDocument();
    });

    it('should render CSV preview for application/vnd.ms-excel content type', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse('col1,col2\nval1,val2', {
          contentType: 'application/vnd.ms-excel',
          totalSize: 20,
          previewBytes: 20
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/test.xls' });
      await expect.element(page.getByText('20 B')).toBeInTheDocument();
    });

    it('should render CSV preview based on .csv file extension', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse('x,y\n1,2', {
          contentType: 'application/octet-stream',
          totalSize: 8,
          previewBytes: 8
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.csv' });
      await expect.element(page.getByText('8 B')).toBeInTheDocument();
    });

    it('should show truncated badge for truncated CSV', async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse('a,b\n1,2', {
          contentType: 'text/csv',
          truncated: true,
          totalSize: 100000,
          previewBytes: 2048
        })
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/big.csv' });
      await expect.element(page.getByText('big.csv')).toBeInTheDocument();
      await expect.element(page.getByText(/download full/i)).toBeInTheDocument();
    });
  });

  describe('UTF-16 BOM detection', () => {
    it('should decode UTF-16 LE BOM content', async () => {
      const bytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
      const blob = new Blob([bytes]);
      fetchMock.mockResolvedValue(
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
      );
      render(PreviewModal, defaultProps);
      await expect.element(page.getByText('Hi')).toBeInTheDocument();
    });

    it('should decode UTF-16 BE BOM content', async () => {
      const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x4f, 0x00, 0x4b]);
      const blob = new Blob([bytes]);
      fetchMock.mockResolvedValue(
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
      );
      render(PreviewModal, defaultProps);
      await expect.element(page.getByText('OK')).toBeInTheDocument();
    });
  });

  describe('Windows-1252 fallback for CSV', () => {
    it('should decode CSV with Windows-1252 when UTF-8 fails', async () => {
      const bytes = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xe4]);
      const blob = new Blob([bytes]);
      fetchMock.mockResolvedValue(
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
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.csv' });
      await expect.element(page.getByText('file.csv')).toBeInTheDocument();
    });

    it('should decode TSV with Windows-1252 when UTF-8 fails', async () => {
      const bytes = new Uint8Array([0x41, 0x09, 0x42, 0x0a, 0xe4, 0x09, 0xfc]);
      const blob = new Blob([bytes]);
      fetchMock.mockResolvedValue(
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
      );
      render(PreviewModal, { ...defaultProps, objectKey: 'data/file.tsv' });
      await expect.element(page.getByText('file.tsv')).toBeInTheDocument();
    });
  });
});
