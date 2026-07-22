import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import UploadEntryStatus from './UploadEntryStatus.svelte';
import type { FileEntry } from './types.js';

function makeEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  const name = overrides.file?.name ?? faker.system.fileName();
  return {
    id: faker.string.uuid(),
    file: new File(['content'], name),
    displayPath: name,
    targetKey: `bucket/${name}`,
    conflict: false,
    resolution: null,
    customName: '',
    renameState: 'idle',
    status: 'pending',
    progress: 0,
    ...overrides
  };
}

describe('UploadEntryStatus', () => {
  describe('status labels', () => {
    it('should show "done" for done status', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'done' }) });
      await expect.element(page.getByText('done')).toBeInTheDocument();
    });

    it('should show "failed" for error status', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'error' }) });
      await expect.element(page.getByText('failed')).toBeInTheDocument();
    });

    it('should show "skipped" for skipped status', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'skipped' }) });
      await expect.element(page.getByText('skipped')).toBeInTheDocument();
    });

    it('should show "queued" for pending status', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'pending' }) });
      await expect.element(page.getByText('queued')).toBeInTheDocument();
    });

    it('should show progress percentage when uploading', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'uploading', progress: 50 }) });
      await expect.element(page.getByText('50%')).toBeInTheDocument();
    });
  });

  describe('progress bar', () => {
    it('should show progress bar when uploading', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'uploading', progress: 75 }) });

      const progressBar = page.getByRole('progressbar');
      await expect.element(progressBar).toBeInTheDocument();
      await expect.element(progressBar).toHaveAttribute('aria-valuenow', '75');
      await expect.element(progressBar).toHaveAttribute('aria-valuemin', '0');
      await expect.element(progressBar).toHaveAttribute('aria-valuemax', '100');
    });

    it('should handle 0% progress', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'uploading', progress: 0 }) });

      await expect.element(page.getByText('0%')).toBeInTheDocument();
      await expect.element(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('should handle 100% progress', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'uploading', progress: 100 }) });

      await expect.element(page.getByText('100%')).toBeInTheDocument();
      await expect.element(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });

    it('should not show progress bar for non-uploading statuses', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'done' }) });

      await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('error display', () => {
    it('should show error message when status is error', async () => {
      const errorMessage = faker.lorem.sentence();
      render(UploadEntryStatus, { entry: makeEntry({ status: 'error', errorMessage }) });

      await expect.element(page.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should not show error paragraph when status is error but errorMessage is absent', async () => {
      render(UploadEntryStatus, { entry: makeEntry({ status: 'error' }) });

      await expect.element(page.getByText('failed')).toBeInTheDocument();
      // Only the "failed" label should exist, no error paragraph
      const errorParagraphs = page.getByRole('listitem').element().querySelectorAll('p.text-error');
      expect(errorParagraphs.length).toBe(0);
    });

    it('should handle long error messages', async () => {
      const errorMessage = faker.lorem.paragraphs(3);
      render(UploadEntryStatus, { entry: makeEntry({ status: 'error', errorMessage }) });

      await expect.element(page.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  describe('file name display', () => {
    it('should show filename from targetKey', async () => {
      const entry = makeEntry({ targetKey: 'deep/nested/path/report.csv' });
      render(UploadEntryStatus, { entry });

      await expect.element(page.getByText('report.csv')).toBeInTheDocument();
    });

    it('should show customName when resolution is rename', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        customName: 'renamed-file.txt',
        targetKey: 'folder/original.txt'
      });
      render(UploadEntryStatus, { entry });

      await expect.element(page.getByText('renamed-file.txt')).toBeInTheDocument();
    });

    it('should fall back to targetKey filename when resolution is rename but customName is empty', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        customName: '   ',
        targetKey: 'folder/fallback.txt'
      });
      render(UploadEntryStatus, { entry });

      await expect.element(page.getByText('fallback.txt')).toBeInTheDocument();
    });

    it('should handle special characters in names', async () => {
      const specialName = 'file (1) [copy] & data.txt';
      const entry = makeEntry({ targetKey: `folder/${specialName}` });
      render(UploadEntryStatus, { entry });

      await expect.element(page.getByText(specialName)).toBeInTheDocument();
    });
  });
});
