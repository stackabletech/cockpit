import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import UploadDropzone from './UploadDropzone.svelte';

describe('UploadDropzone', () => {
  describe('rendering', () => {
    it('should have a drop zone with role button', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      await expect
        .element(
          page.getByRole('button', { name: 'Drop files or a folder here, or click to browse' })
        )
        .toBeInTheDocument();
    });

    it('should have Select files button', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      await expect.element(page.getByRole('button', { name: 'Select files' })).toBeInTheDocument();
    });

    it('should have Select folder button', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      await expect.element(page.getByRole('button', { name: 'Select folder' })).toBeInTheDocument();
    });

    it('should have hidden file inputs', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const fileInput = page.getByLabelText('Select files');
      const dirInput = page.getByLabelText('Select folder');
      await expect.element(fileInput).toBeInTheDocument();
      await expect.element(dirInput).toBeInTheDocument();
    });
  });

  describe('keyboard accessibility', () => {
    it('should have tabindex on drop zone', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      await expect.element(dropzone).toHaveAttribute('tabindex', '0');
    });
  });

  describe('file selection', () => {
    it('should call onFilesSelected when files are chosen via file input', async () => {
      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const fileName = faker.system.fileName();
      const file = new File(['data'], fileName);
      const fileInput = page.getByLabelText('Select files');

      // Simulate file input change by dispatching on the underlying element
      const inputEl = fileInput.element() as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      expect(onFilesSelected).toHaveBeenCalledWith([
        { file: expect.any(File), relativePath: fileName }
      ]);
    });

    it('should not call onFilesSelected for empty file list', async () => {
      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const fileInput = page.getByLabelText('Select files');
      const inputEl = fileInput.element() as HTMLInputElement;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      expect(onFilesSelected).not.toHaveBeenCalled();
    });

    it('should handle multiple files', async () => {
      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const files = Array.from({ length: 5 }, () => new File(['x'], faker.system.fileName()));
      const fileInput = page.getByLabelText('Select files');
      const inputEl = fileInput.element() as HTMLInputElement;
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      expect(onFilesSelected).toHaveBeenCalledOnce();
      expect(onFilesSelected.mock.calls[0][0]).toHaveLength(5);
    });
  });
});
