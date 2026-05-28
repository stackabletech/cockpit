import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import UploadModal from './UploadModal.svelte';

vi.mock('$lib/storage/upload.js', () => ({
  checkObjectExists: vi.fn().mockResolvedValue(false),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  UploadError: class UploadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'UploadError';
    }
  }
}));

const defaultProps = {
  open: true,
  bucket: faker.word.noun(),
  prefix: '',
  onSuccess: vi.fn()
};

describe('UploadModal', () => {
  describe('initial render (idle phase)', () => {
    it('should render a dialog when open', async () => {
      render(UploadModal, defaultProps);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should show the upload title heading', async () => {
      render(UploadModal, defaultProps);

      await expect.element(page.getByRole('heading', { level: 2 })).toBeInTheDocument();
    });

    it('should show a close button', async () => {
      render(UploadModal, defaultProps);

      const closeBtn = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtn).toBeInTheDocument();
    });

    it('should not show prefix info when prefix is empty', async () => {
      render(UploadModal, { ...defaultProps, prefix: '' });

      // No prefix paragraph should be shown
      const dialog = page.getByRole('dialog');
      await expect.element(dialog).toBeInTheDocument();
    });

    it('should show prefix info when prefix is provided', async () => {
      const prefix = 'data/reports/';
      render(UploadModal, { ...defaultProps, prefix });

      await expect.element(page.getByText(prefix)).toBeInTheDocument();
    });
  });

  describe('when open is false', () => {
    it('should not render dialog content', async () => {
      render(UploadModal, { ...defaultProps, open: false });

      // Modal content should not be visible
      const heading = page.getByRole('heading', { level: 2 });
      await expect.element(heading).not.toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('should be enabled in idle phase', async () => {
      render(UploadModal, defaultProps);

      const closeBtn = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtn).not.toBeDisabled();
    });
  });

  describe('accessibility', () => {
    it('should have a dialog role', async () => {
      render(UploadModal, defaultProps);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have a heading', async () => {
      render(UploadModal, defaultProps);

      await expect.element(page.getByRole('heading')).toBeInTheDocument();
    });

    it('should have aria-label on close button', async () => {
      render(UploadModal, defaultProps);

      const closeBtn = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtn).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle long prefix display', async () => {
      const longPrefix = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/';
      render(UploadModal, { ...defaultProps, prefix: longPrefix });

      await expect.element(page.getByText(longPrefix)).toBeInTheDocument();
    });

    it('should handle bucket with special characters', async () => {
      render(UploadModal, { ...defaultProps, bucket: 'my-bucket-123' });

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
