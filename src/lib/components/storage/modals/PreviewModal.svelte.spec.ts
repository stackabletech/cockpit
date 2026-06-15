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

function mockFetchResponse(body: BodyInit | null): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'X-Preview-Format': 'text',
      'X-Preview-Truncated': 'false',
      'X-Preview-Total-Size': '11',
      'X-Preview-Bytes': '11'
    }
  });
}

describe('PreviewModal basics', () => {
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
      fetchMock.mockReturnValue(new Promise(() => {}));
      render(PreviewModal, defaultProps);
      await expect.element(page.getByText('Loading preview\u2026')).toBeInTheDocument();
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
