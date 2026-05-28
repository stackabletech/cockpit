import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import PreviewModal from './PreviewModal.svelte';

// Mock $app/paths
vi.mock('$app/paths', () => ({
  resolve: (path: string) => path
}));

const defaultProps = {
  open: true,
  bucket: faker.word.noun(),
  objectKey: 'path/to/document.txt'
};

describe('PreviewModal', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Hello world', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'X-Preview-Format': 'text',
            'X-Preview-Truncated': 'false',
            'X-Preview-Total-Size': '11',
            'X-Preview-Bytes': '11'
          }
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
      // Mock fetch that never resolves
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
  });

  describe('text preview', () => {
    it('should render text content after fetch completes', async () => {
      render(PreviewModal, defaultProps);

      // Wait for loading to finish and text to appear
      await expect.element(page.getByText('Hello world')).toBeInTheDocument();
    });

    it('should show file size badge', async () => {
      render(PreviewModal, defaultProps);

      await expect.element(page.getByText('11 B')).toBeInTheDocument();
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
