import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import DeleteConfirmModal from './DeleteConfirmModal.svelte';

const defaultProps = {
  open: true,
  keys: ['file.txt'],
  onConfirm: () => {},
  onCancel: () => {}
};

describe('DeleteConfirmModal', () => {
  describe('single file deletion', () => {
    it('should show heading with file name for single key', async () => {
      render(DeleteConfirmModal, { ...defaultProps, keys: ['report.csv'] });

      await expect
        .element(page.getByRole('heading', { name: /Delete "report.csv"/ }))
        .toBeInTheDocument();
    });

    it('should show confirmation message', async () => {
      render(DeleteConfirmModal, defaultProps);

      await expect.element(page.getByText('This action cannot be undone.')).toBeInTheDocument();
    });

    it('should extract filename from path', async () => {
      render(DeleteConfirmModal, { ...defaultProps, keys: ['path/to/deep/file.txt'] });

      await expect
        .element(page.getByRole('heading', { name: /Delete "file.txt"/ }))
        .toBeInTheDocument();
    });
  });

  describe('multiple file deletion', () => {
    it('should show count in heading for multiple keys', async () => {
      const keys = ['a.txt', 'b.txt', 'c.txt'];
      render(DeleteConfirmModal, { ...defaultProps, keys });

      await expect
        .element(page.getByRole('heading', { name: /Delete 3 items/ }))
        .toBeInTheDocument();
    });

    it('should handle large number of keys', async () => {
      const keys = Array.from({ length: 50 }, () => faker.system.fileName());
      render(DeleteConfirmModal, { ...defaultProps, keys });

      await expect
        .element(page.getByRole('heading', { name: /Delete 50 items/ }))
        .toBeInTheDocument();
    });
  });

  describe('directory warning', () => {
    it('should show warning when keys include directories', async () => {
      render(DeleteConfirmModal, { ...defaultProps, keys: ['folder/'] });

      await expect
        .element(page.getByText('All contents will be permanently deleted'))
        .toBeInTheDocument();
    });

    it('should show warning body text for directories', async () => {
      render(DeleteConfirmModal, { ...defaultProps, keys: ['data/subfolder/'] });

      await expect
        .element(page.getByText(/Deleting a folder removes every file/))
        .toBeInTheDocument();
    });

    it('should not show warning for regular files', async () => {
      render(DeleteConfirmModal, { ...defaultProps, keys: ['file.txt'] });

      const warning = page.getByText('All contents will be permanently deleted');
      await expect.element(warning).not.toBeInTheDocument();
    });

    it('should show warning when mix of files and directories', async () => {
      render(DeleteConfirmModal, { ...defaultProps, keys: ['file.txt', 'folder/'] });

      await expect
        .element(page.getByText('All contents will be permanently deleted'))
        .toBeInTheDocument();
    });

    it('should have alert role on warning', async () => {
      render(DeleteConfirmModal, { ...defaultProps, keys: ['folder/'] });

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('button interactions', () => {
    it('should render cancel and delete buttons', async () => {
      render(DeleteConfirmModal, defaultProps);

      await expect.element(page.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
      await expect
        .element(page.getByRole('button', { name: /Delete permanently/i }))
        .toBeInTheDocument();
    });

    it('should call onConfirm when delete button is clicked', async () => {
      const onConfirm = vi.fn();
      render(DeleteConfirmModal, { ...defaultProps, onConfirm });

      await page.getByRole('button', { name: /Delete permanently/i }).click();
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('should call onCancel when cancel button is clicked', async () => {
      const onCancel = vi.fn();
      render(DeleteConfirmModal, { ...defaultProps, onCancel });

      await page.getByRole('button', { name: /Cancel/i }).click();
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('edge cases with faker', () => {
    it('should handle keys with special characters', async () => {
      const keys = ['file (1).txt', 'data [backup].csv', "name's file.doc"];
      render(DeleteConfirmModal, { ...defaultProps, keys });

      await expect
        .element(page.getByRole('heading', { name: /Delete 3 items/ }))
        .toBeInTheDocument();
    });

    it('should handle deeply nested directory paths', async () => {
      const keys = ['a/b/c/d/e/f/g/'];
      render(DeleteConfirmModal, { ...defaultProps, keys });

      await expect.element(page.getByRole('heading', { name: /Delete "g"/ })).toBeInTheDocument();
    });

    it('should handle keys generated by faker', async () => {
      const keys = Array.from(
        { length: 5 },
        () => `${faker.system.directoryPath()}/${faker.system.fileName()}`
      );
      render(DeleteConfirmModal, { ...defaultProps, keys });

      await expect
        .element(page.getByRole('heading', { name: /Delete 5 items/ }))
        .toBeInTheDocument();
    });
  });
});
