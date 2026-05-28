import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { StorageState } from '$lib/storage/state.svelte.js';
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

function createMockStorageState(activeModal: unknown = null): StorageState {
  return {
    bucket: 'test-bucket',
    prefix: '',
    activeModal,
    closeModal: vi.fn(),
    confirmDelete: vi.fn(),
    cancelDelete: vi.fn(),
    handleUploadSuccess: vi.fn()
  } as unknown as StorageState;
}

// Mock the storage context
vi.mock('$lib/storage/context.js', () => ({
  getStorageState: vi.fn()
}));

import { getStorageState } from '$lib/storage/context.js';

describe('StorageModals', () => {
  describe('no active modal', () => {
    it('should not render any modal when activeModal is null', async () => {
      vi.mocked(getStorageState).mockReturnValue(createMockStorageState(null));
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
        })
      );
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await expect.element(page.getByRole('heading', { name: /delete/i })).toBeInTheDocument();
    });

    it('should call closeModal when delete dialog is closed via Escape', async () => {
      const mockState = createMockStorageState({
        type: 'delete',
        payload: { keys: ['file.txt'] }
      });
      vi.mocked(getStorageState).mockReturnValue(mockState);
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => mockState.closeModal).toHaveBeenCalled();
    });
  });

  describe('preview modal', () => {
    it('should render PreviewModal when activeModal type is preview', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      vi.mocked(getStorageState).mockReturnValue(
        createMockStorageState({
          type: 'preview',
          payload: { key: 'path/to/file.txt' }
        })
      );
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await expect.element(page.getByText('file.txt')).toBeInTheDocument();
    });

    it('should call closeModal when preview dialog is closed via Escape', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      const mockState = createMockStorageState({
        type: 'preview',
        payload: { key: 'path/to/file.txt' }
      });
      vi.mocked(getStorageState).mockReturnValue(mockState);
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => mockState.closeModal).toHaveBeenCalled();
    });
  });

  describe('upload modal', () => {
    it('should render UploadModal when activeModal type is upload', async () => {
      vi.mocked(getStorageState).mockReturnValue(
        createMockStorageState({
          type: 'upload',
          payload: { bucket: 'my-bucket', prefix: 'data/' }
        })
      );
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should call closeModal when upload dialog is closed via Escape', async () => {
      const mockState = createMockStorageState({
        type: 'upload',
        payload: { bucket: 'my-bucket', prefix: 'data/' }
      });
      vi.mocked(getStorageState).mockReturnValue(mockState);
      render(StorageModals);

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => mockState.closeModal).toHaveBeenCalled();
    });
  });
});
