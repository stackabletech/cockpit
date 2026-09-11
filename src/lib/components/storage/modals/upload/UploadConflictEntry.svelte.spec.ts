import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import UploadConflictEntry from './UploadConflictEntry.svelte';
import type { FileEntry } from './types.js';

function makeEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  const name = overrides.file?.name ?? faker.system.fileName();
  return {
    id: faker.string.uuid(),
    file: new File(['content'], name),
    displayPath: name,
    targetKey: `path/to/${name}`,
    conflict: true,
    resolution: null,
    customName: name,
    renameState: 'idle',
    status: 'pending',
    progress: 0,
    ...overrides
  };
}

const defaultCallbacks = {
  onSetResolution: vi.fn(),
  onSetCustomName: vi.fn(),
  onRenameButtonClick: vi.fn(),
  onCheckRename: vi.fn()
};

describe('UploadConflictEntry', () => {
  describe('rendering', () => {
    it('should show the file name in quotes', async () => {
      const entry = makeEntry({ targetKey: 'folder/report.csv' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect.element(page.getByText(/\u201Creport.csv\u201D/)).toBeInTheDocument();
    });

    it('should show a button group with Replace, Skip, Rename', async () => {
      const entry = makeEntry();
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect.element(page.getByRole('group')).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    });

    it('should handle long filenames', async () => {
      const longName = faker.string.alpha(200) + '.txt';
      const entry = makeEntry({ targetKey: `deep/nested/${longName}` });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      // eslint-disable-next-line security/detect-non-literal-regexp
      await expect.element(page.getByText(new RegExp(longName.slice(0, 20)))).toBeInTheDocument();
    });
  });

  describe('resolution buttons', () => {
    it('should mark Replace as pressed when resolution is replace', async () => {
      const entry = makeEntry({ resolution: 'replace' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      const btn = page.getByRole('button', { name: 'Replace' });
      await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
    });

    it('should mark Skip as pressed when resolution is skip', async () => {
      const entry = makeEntry({ resolution: 'skip' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      const btn = page.getByRole('button', { name: 'Skip' });
      await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
    });

    it('should call onSetResolution with replace when Replace is clicked', async () => {
      const onSetResolution = vi.fn();
      const entry = makeEntry();
      render(UploadConflictEntry, { entry, ...defaultCallbacks, onSetResolution });

      await page.getByRole('button', { name: 'Replace' }).click();
      expect(onSetResolution).toHaveBeenCalledWith('replace');
    });

    it('should call onSetResolution with skip when Skip is clicked', async () => {
      const onSetResolution = vi.fn();
      const entry = makeEntry();
      render(UploadConflictEntry, { entry, ...defaultCallbacks, onSetResolution });

      await page.getByRole('button', { name: 'Skip' }).click();
      expect(onSetResolution).toHaveBeenCalledWith('skip');
    });

    it('should call onRenameButtonClick when Rename is clicked', async () => {
      const onRenameButtonClick = vi.fn();
      const entry = makeEntry();
      render(UploadConflictEntry, { entry, ...defaultCallbacks, onRenameButtonClick });

      await page.getByRole('button', { name: 'Rename' }).click();
      expect(onRenameButtonClick).toHaveBeenCalled();
    });
  });

  describe('rename state', () => {
    it('should show loading spinner when renameState is checking', async () => {
      const entry = makeEntry({ resolution: 'rename', renameState: 'checking' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      const btn = page.getByRole('button', { name: /Rename/ });
      await expect.element(btn).toBeDisabled();
    });

    it('should show input field when renameState is editing', async () => {
      const entry = makeEntry({ resolution: 'rename', renameState: 'editing' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect
        .element(page.getByRole('textbox', { name: 'New file name' }))
        .toBeInTheDocument();
    });

    it('should show input field when renameState is conflict', async () => {
      const entry = makeEntry({ resolution: 'rename', renameState: 'conflict' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect
        .element(page.getByRole('textbox', { name: 'New file name' }))
        .toBeInTheDocument();
    });

    it('should show error when renameState is conflict', async () => {
      const file = new File(['x'], 'original.txt');
      const entry = makeEntry({
        file,
        resolution: 'rename',
        renameState: 'conflict',
        customName: 'different-name.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent('This name already exists here.');
    });

    it('should show error when customName is empty (badRename)', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'editing',
        customName: '  '
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should show error when customName matches original file name', async () => {
      const file = new File(['x'], 'original.txt');
      const entry = makeEntry({
        file,
        resolution: 'rename',
        renameState: 'editing',
        customName: 'original.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });

    it('should call onCheckRename when Enter is pressed in input', async () => {
      const onCheckRename = vi.fn();
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'editing',
        customName: 'new-name.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks, onCheckRename });

      const input = page.getByRole('textbox', { name: 'New file name' });
      const inputEl = input.element() as HTMLInputElement;
      inputEl.focus();
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(onCheckRename).toHaveBeenCalled();
    });

    it('should show "Confirm name" text when editing', async () => {
      const entry = makeEntry({ resolution: 'rename', renameState: 'editing' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect.element(page.getByRole('button', { name: /Confirm name/ })).toBeInTheDocument();
    });

    it('should show check icon and success button when renameState is ok', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'ok',
        customName: 'new-name.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      // Should show the static display with the custom name (not the input)
      await expect.element(page.getByText('new-name.txt')).toBeInTheDocument();
      // Button should have success styling and show "Rename" text (not "Confirm name")
      const btn = page.getByRole('button', { name: /Rename/ });
      await expect.element(btn).toBeInTheDocument();
      await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
    });

    it('should call onSetCustomName when input value changes', async () => {
      const onSetCustomName = vi.fn();
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'editing',
        customName: 'old.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks, onSetCustomName });

      const input = page.getByRole('textbox', { name: 'New file name' });
      const inputEl = input.element() as HTMLInputElement;
      inputEl.focus();
      inputEl.value = 'new-value.txt';
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onSetCustomName).toHaveBeenCalledWith('new-value.txt');
    });

    it('should show "Confirm name" text when renameState is conflict', async () => {
      const file = new File(['x'], 'original.txt');
      const entry = makeEntry({
        file,
        resolution: 'rename',
        renameState: 'conflict',
        customName: 'different.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect.element(page.getByRole('button', { name: /Confirm name/ })).toBeInTheDocument();
    });

    it('should not call onCheckRename when a non-Enter key is pressed', async () => {
      const onCheckRename = vi.fn();
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'editing',
        customName: 'new-name.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks, onCheckRename });

      const input = page.getByRole('textbox', { name: 'New file name' });
      const inputEl = input.element() as HTMLInputElement;
      inputEl.focus();
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      expect(onCheckRename).not.toHaveBeenCalled();
    });
  });

  describe('nameOnly derivation', () => {
    it('should fall back to file.name when targetKey has no path separator', async () => {
      const file = new File(['x'], 'fallback.txt');
      const entry = makeEntry({ file, targetKey: 'fallback.txt' });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      await expect.element(page.getByText(/\u201Cfallback.txt\u201D/)).toBeInTheDocument();
    });

    it('should not show error when customName is valid and different', async () => {
      const file = new File(['x'], 'original.txt');
      const entry = makeEntry({
        file,
        resolution: 'rename',
        renameState: 'editing',
        customName: 'different.txt'
      });
      render(UploadConflictEntry, { entry, ...defaultCallbacks });

      // Input should be present and have no error styling
      const input = page.getByRole('textbox', { name: 'New file name' });
      await expect.element(input).toBeInTheDocument();
      // The input should not have error class
      const inputEl = input.element() as HTMLInputElement;
      expect(inputEl.classList.contains('input-error')).toBe(false);
    });
  });
});
