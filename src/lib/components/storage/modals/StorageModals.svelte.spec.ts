import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StorageModals from './StorageModals.svelte';

// Mock $app/paths for PreviewModal
vi.mock('$app/paths', () => ({
  resolve: (path: string) => path
}));

// Mock upload module
vi.mock('$lib/storage/upload.js', () => ({
  checkObjectExists: vi.fn().mockResolvedValue(false),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  UploadError: class UploadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
}));

function createMockStorageState(activeModal: unknown = null) {
  return {
    bucket: 'test-bucket',
    prefix: '',
    activeModal,
    closeModal: vi.fn(),
    confirmDelete: vi.fn(),
    cancelDelete: vi.fn(),
    handleUploadSuccess: vi.fn()
  };
}

// Mock the storage context
vi.mock('$lib/storage/context.js', () => ({
  getStorageState: vi.fn()
}));

import { getStorageState } from '$lib/storage/context.js';

describe('StorageModals', () => {
  describe('no active modal', () => {
    it('should not render any modal when activeModal is null', async () => {
      vi.mocked(getStorageState).mockReturnValue(createMockStorageState(null) as any);
      render(StorageModals);

      const dialog = page.getByRole('dialog');
      await expect.element(dialog).not.toBeInTheDocument();
    });
  });

  describe('delete modal', () => {
    it('should render DeleteConfirmModal when activeModal type is delete', async () => {
      vi.mocked(getStorageState).mockReturnValue(
        createMockStorageState({
          type: 'delete',
          payload: { keys: ['file.txt'] }
        }) as any
      );
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await expect.element(page.getByRole('heading', { name: /delete/i })).toBeInTheDocument();
    });
  });

  describe('preview modal', () => {
    it('should render PreviewModal when activeModal type is preview', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      vi.mocked(getStorageState).mockReturnValue(
        createMockStorageState({
          type: 'preview',
          payload: { key: 'path/to/file.txt' }
        }) as any
      );
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await expect.element(page.getByText('file.txt')).toBeInTheDocument();
    });
  });

  describe('upload modal', () => {
    it('should render UploadModal when activeModal type is upload', async () => {
      vi.mocked(getStorageState).mockReturnValue(
        createMockStorageState({
          type: 'upload',
          payload: { bucket: 'my-bucket', prefix: 'data/' }
        }) as any
      );
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
