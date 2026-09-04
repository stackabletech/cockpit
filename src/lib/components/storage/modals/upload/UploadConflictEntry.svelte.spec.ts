import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import ConflictEntry from '../shared/ConflictEntry.svelte';
import type { ConflictEntry as ConflictEntryType } from '../shared/conflict-types.js';

function makeEntry(overrides: Partial<ConflictEntryType> = {}): ConflictEntryType {
  const name = overrides.originalName ?? faker.system.fileName();
  return {
    id: faker.string.uuid(),
    originalName: name,
    conflict: true,
    resolution: null,
    customName: name,
    renameState: 'idle',
    ...overrides
  };
}

const defaultCallbacks = {
  onSetResolution: vi.fn(),
  onSetCustomName: vi.fn(),
  onRenameButtonClick: vi.fn(),
  onCheckRename: vi.fn()
};

describe('ConflictEntry', () => {
  describe('rendering', () => {
    it('should show the file name in quotes', async () => {
      const entry = makeEntry({ originalName: 'report.csv' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const listItem = screen.getByRole('group');
      await expect.element(listItem).toBeInTheDocument();
    });

    it('should default to Replace and Skip buttons in ghost variant', async () => {
      const entry = makeEntry();
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const replaceBtn = screen.getByRole('button', { name: /Replace/ });
      const skipBtn = screen.getByRole('button', { name: /Skip/ });
      await expect.element(replaceBtn).toBeInTheDocument();
      await expect.element(skipBtn).toBeInTheDocument();
    });

    it('should highlight Replace button with warning style when selected', async () => {
      const entry = makeEntry({ resolution: 'replace' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const replaceBtn = screen.getByRole('button', { name: /Replace/ });
      await expect.element(replaceBtn).toHaveClass('btn-warning');
    });

    it('should highlight Skip button with neutral style when selected', async () => {
      const entry = makeEntry({ resolution: 'skip' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const skipBtn = screen.getByRole('button', { name: /Skip/ });
      await expect.element(skipBtn).toHaveClass('btn-neutral');
    });

    it('should apply aria-pressed on active button', async () => {
      const entry = makeEntry({ resolution: 'replace' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const replaceBtn = screen.getByRole('button', { name: /Replace/ });
      await expect.element(replaceBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('should not set aria-pressed on inactive buttons', async () => {
      const entry = makeEntry({ resolution: 'replace' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const skipBtn = screen.getByRole('button', { name: /Skip/ });
      await expect.element(skipBtn).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('callbacks', () => {
    it('should call onSetResolution when Replace button is clicked', async () => {
      const onSetResolution = vi.fn();
      const entry = makeEntry();
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks, onSetResolution });
      await screen.getByRole('button', { name: /Replace/ }).click();
      expect(onSetResolution).toHaveBeenCalledWith('replace');
    });

    it('should call onSetResolution when Skip button is clicked', async () => {
      const onSetResolution = vi.fn();
      const entry = makeEntry({ resolution: 'replace' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks, onSetResolution });
      await screen.getByRole('button', { name: /Skip/ }).click();
      expect(onSetResolution).toHaveBeenCalledWith('skip');
    });

    it('should call onRenameButtonClick when Rename button is clicked', async () => {
      const onRenameButtonClick = vi.fn();
      const entry = makeEntry();
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks, onRenameButtonClick });
      await screen.getByRole('button', { name: /Rename/ }).click();
      expect(onRenameButtonClick).toHaveBeenCalledOnce();
    });

    it('should show a text input in editing rename state', async () => {
      const entry = makeEntry({ resolution: 'rename', renameState: 'editing' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const input = screen.getByPlaceholder('New file name');
      await expect.element(input).toBeInTheDocument();
    });

    it('should call onSetCustomName when text is entered', async () => {
      const onSetCustomName = vi.fn();
      const entry = makeEntry({ resolution: 'rename', renameState: 'editing' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks, onSetCustomName });
      const input = screen.getByPlaceholder('New file name');
      await input.fill('newname.csv');
      expect(onSetCustomName).toHaveBeenCalledWith('newname.csv');
    });

    it('should not call onRenameButtonClick before changing the value when Enter is pressed', async () => {
      const onRenameButtonClick = vi.fn();
      const entry = makeEntry({ resolution: 'rename', renameState: 'editing' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks, onRenameButtonClick });
      // Should show the rename input
      await expect.element(screen.getByPlaceholder('New file name')).toBeInTheDocument();
    });

    it('should show a spinner during rename checking', async () => {
      const entry = makeEntry({ resolution: 'rename', renameState: 'checking' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      await expect.element(screen.getByRole('button', { name: /Rename/ })).toBeInTheDocument();
      const renameBtn = screen.getByRole('button', { name: /Rename/ });
      await expect.element(renameBtn).toBeDisabled();
    });

    it('should show a check icon when rename is confirmed', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'ok',
        customName: 'newname.csv'
      });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      await expect.element(screen.getByText('newname.csv')).toBeInTheDocument();
    });

    it('should change label to "Confirm name" when in editing state', async () => {
      const entry = makeEntry({ resolution: 'rename', renameState: 'editing' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const renameBtn = screen.getByRole('button', { name: /Confirm name/ });
      await expect.element(renameBtn).toBeInTheDocument();
    });

    it('should show an error when new name matches the original', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'editing',
        originalName: 'same.txt',
        customName: 'same.txt'
      });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      await expect
        .element(screen.getByText('Please enter a different name, or select Replace or Skip.'))
        .toBeInTheDocument();
    });

    it('should show an error when rename conflicts with existing file', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'conflict',
        originalName: 'original.txt',
        customName: 'newname.txt'
      });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      await expect.element(screen.getByText(/This name already exists/)).toBeInTheDocument();
    });

    it('should call onRenameButtonClick when the Rename button shows "Confirm name"', async () => {
      const onRenameButtonClick = vi.fn();
      const entry = makeEntry({ resolution: 'rename', renameState: 'editing' });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks, onRenameButtonClick });
      await screen.getByRole('button', { name: /Confirm name/ }).click();
      expect(onRenameButtonClick).toHaveBeenCalledOnce();
    });

    it('should show error state styling on the input when the same name is entered', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'editing',
        originalName: 'same.txt',
        customName: 'same.txt'
      });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const input = screen.getByPlaceholder('New file name');
      await expect.element(input).toHaveClass('input-error');
    });

    it('should show error state styling on the input when rename conflicts', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'conflict',
        originalName: 'original.txt',
        customName: 'newname.txt'
      });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      const input = screen.getByPlaceholder('New file name');
      await expect.element(input).toHaveClass('input-error');
    });

    it('should show an input in conflict state with rename selected', async () => {
      const entry = makeEntry({
        resolution: 'rename',
        renameState: 'conflict',
        originalName: 'original.txt',
        customName: 'newname.txt'
      });
      const screen = render(ConflictEntry, { entry, ...defaultCallbacks });
      await expect.element(screen.getByPlaceholder('New file name')).toBeInTheDocument();
      await expect.element(screen.getByText(/This name already exists/)).toBeInTheDocument();
    });
  });
});
