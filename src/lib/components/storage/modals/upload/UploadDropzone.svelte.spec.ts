import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import UploadDropzone from './UploadDropzone.svelte';

vi.mock('$lib/storage/file-collection.js', () => ({
  collectDroppedFiles: vi.fn()
}));

async function getCollectDroppedFilesMock() {
  const mod = await import('$lib/storage/file-collection.js');
  return mod.collectDroppedFiles as ReturnType<typeof vi.fn>;
}

function createDropEvent(files: File[]): DragEvent {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  return new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt
  });
}

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

      await expect
        .element(page.getByRole('button', { name: 'Select files' }).first())
        .toBeInTheDocument();
    });

    it('should have Select folder button', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      await expect
        .element(page.getByRole('button', { name: 'Select folder' }).first())
        .toBeInTheDocument();
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

    it('should trigger file input on Enter key', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      const fileInput = page.getByLabelText('Select files').element() as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      dropzoneEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should trigger file input on Space key', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      const fileInput = page.getByLabelText('Select files').element() as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      dropzoneEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should not trigger file input on other keys', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      const fileInput = page.getByLabelText('Select files').element() as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      dropzoneEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(clickSpy).not.toHaveBeenCalled();
    });
  });

  describe('file selection', () => {
    it('should call onFilesSelected when files are chosen via file input', async () => {
      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const fileName = faker.system.fileName();
      const file = new File(['data'], fileName);
      const fileInput = page.getByLabelText('Select files');

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

    it('should reset input value after file selection', async () => {
      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const file = new File(['data'], 'test.txt');
      const fileInput = page.getByLabelText('Select files');
      const inputEl = fileInput.element() as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      expect(inputEl.value).toBe('');
    });

    it('should call onFilesSelected when files are chosen via directory input', async () => {
      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const file = new File(['data'], 'file.txt');
      const dirInput = page.getByLabelText('Select folder');
      const inputEl = dirInput.element() as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      expect(onFilesSelected).toHaveBeenCalledOnce();
    });
  });

  describe('drag and drop', () => {
    it('should add visual feedback on dragover', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      dropzoneEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));

      // After dragover, the element should have the active drag classes
      await expect.element(dropzone).toHaveClass(/border-primary/);
    });

    it('should remove visual feedback on dragleave', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      // First dragover to set dragOver = true
      dropzoneEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
      // Then dragleave to set dragOver = false
      dropzoneEl.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));

      // The border-primary class from the conditional should be gone
      // The element still has hover:border-primary/60 but not the conditional border-primary
      const classes = dropzoneEl.className;
      // The conditional adds 'border-primary bg-primary/5' when dragOver is true
      // When false, those classes are not present (the empty string branch)
      expect(classes).not.toContain(' border-primary ');
    });

    it('should call onFilesSelected on drop with collected files', async () => {
      const collectMock = await getCollectDroppedFilesMock();
      const fileName = faker.system.fileName();
      const file = new File(['data'], fileName);
      collectMock.mockResolvedValueOnce([{ file, relativePath: fileName }]);

      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      const dropEvent = createDropEvent([file]);
      dropzoneEl.dispatchEvent(dropEvent);

      // Wait for async handleDrop
      await vi.waitFor(() => {
        expect(onFilesSelected).toHaveBeenCalledWith([{ file, relativePath: fileName }]);
      });
    });

    it('should fall back to dt.files when collectDroppedFiles throws', async () => {
      const collectMock = await getCollectDroppedFilesMock();
      collectMock.mockRejectedValueOnce(new Error('unsupported'));

      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      const file = new File(['data'], 'fallback.txt');
      const dropEvent = createDropEvent([file]);
      dropzoneEl.dispatchEvent(dropEvent);

      await vi.waitFor(() => {
        expect(onFilesSelected).toHaveBeenCalledWith([
          { file: expect.any(File), relativePath: 'fallback.txt' }
        ]);
      });
    });

    it('should not call onFilesSelected when drop has no files', async () => {
      const collectMock = await getCollectDroppedFilesMock();
      collectMock.mockResolvedValueOnce([]);

      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      const dropEvent = createDropEvent([]);
      dropzoneEl.dispatchEvent(dropEvent);

      // Wait a tick to ensure the async handler completes
      await new Promise((r) => setTimeout(r, 50));
      expect(onFilesSelected).not.toHaveBeenCalled();
    });

    it('should handle drop with no dataTransfer', async () => {
      const onFilesSelected = vi.fn();
      render(UploadDropzone, { onFilesSelected });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      // DragEvent without dataTransfer
      const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true });
      dropzoneEl.dispatchEvent(dropEvent);

      await new Promise((r) => setTimeout(r, 50));
      expect(onFilesSelected).not.toHaveBeenCalled();
    });

    it('should reset dragOver on drop', async () => {
      const collectMock = await getCollectDroppedFilesMock();
      collectMock.mockResolvedValueOnce([]);

      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;

      // Set dragOver = true first
      dropzoneEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
      // Then drop
      const dropEvent = createDropEvent([]);
      dropzoneEl.dispatchEvent(dropEvent);

      await vi.waitFor(() => {
        // dragOver should be false, so no conditional border-primary class
        expect(dropzoneEl.className).not.toMatch(/\bborder-primary\b(?!\/)/);
      });
    });
  });

  describe('click interactions', () => {
    it('should open file picker on dropzone click', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const fileInput = page.getByLabelText('Select files').element() as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      const dropzone = page.getByRole('button', {
        name: 'Drop files or a folder here, or click to browse'
      });
      const dropzoneEl = dropzone.element() as HTMLElement;
      dropzoneEl.click();

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should open file picker on Select files button click', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const fileInput = page.getByLabelText('Select files').element() as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      const btn = page.getByRole('button', { name: 'Select files' }).first();
      (btn.element() as HTMLElement).click();

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should open directory picker on Select folder button click', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dirInput = page.getByLabelText('Select folder').element() as HTMLInputElement;
      const clickSpy = vi.spyOn(dirInput, 'click');

      const btn = page.getByRole('button', { name: 'Select folder' }).first();
      (btn.element() as HTMLElement).click();

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('directory input', () => {
    it('should set webkitdirectory attribute on directory input', async () => {
      render(UploadDropzone, { onFilesSelected: vi.fn() });

      const dirInput = page.getByLabelText('Select folder');
      await expect.element(dirInput).toHaveAttribute('webkitdirectory');
    });
  });
});
