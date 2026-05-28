import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { SvelteSet } from 'svelte/reactivity';
import FolderRowWrapper from './__tests__/FolderRowWrapper.svelte';
import type { StorageObject } from '$lib/storage/types.js';
import { StorageState } from '$lib/storage/state.svelte.js';

function makeFolder(key: string): StorageObject {
  return {
    key,
    size: 0,
    lastModified: faker.date.recent(),
    isDirectory: true,
    contentType: undefined
  };
}

function createState(
  folders: StorageObject[] = [],
  opts: { selectionMode?: boolean; selectedKeys?: string[] } = {}
): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'] });
  state.bucket = 'test-bucket';
  state.prefix = '';
  state.objects = {
    objects: folders,
    hasNextPage: false,
    currentPage: 1,
    pageSize: 25
  };
  if (opts.selectionMode) state.selectionMode = true;
  if (opts.selectedKeys) state.selectedKeys = new SvelteSet(opts.selectedKeys);
  return state;
}

describe('FolderRow', () => {
  it('should render the folder name', async () => {
    const folder = makeFolder('documents/');
    const state = createState([folder]);
    render(FolderRowWrapper, { state, folder });

    await expect.element(page.getByText('documents')).toBeInTheDocument();
  });

  it('should show dash for size and last modified', async () => {
    const folder = makeFolder('data/');
    const state = createState([folder]);
    render(FolderRowWrapper, { state, folder });

    const dashes = page.getByText('—');
    expect(dashes.elements().length).toBe(2);
  });

  it('should navigate on click when not in selection mode', async () => {
    const folder = makeFolder('photos/');
    const state = createState([folder]);
    const spy = vi.spyOn(state, 'navigate');
    render(FolderRowWrapper, { state, folder });

    await page.getByRole('row').click();
    expect(spy).toHaveBeenCalledWith('photos/');
  });

  it('should toggle selection on click in selection mode', async () => {
    const folder = makeFolder('photos/');
    const state = createState([folder], { selectionMode: true });
    const spy = vi.spyOn(state, 'toggleSelect');
    render(FolderRowWrapper, { state, folder });

    await page.getByRole('row').click();
    expect(spy).toHaveBeenCalledWith('photos/', true);
  });

  it('should call openContextMenu on right click', async () => {
    const folder = makeFolder('logs/');
    const state = createState([folder]);
    const spy = vi.spyOn(state, 'openContextMenu');
    render(FolderRowWrapper, { state, folder });

    await page.getByText('logs').click({ button: 'right' });
    expect(spy).toHaveBeenCalled();
  });

  it('should show checkbox when showCheckboxes is true', async () => {
    const folder = makeFolder('backup/');
    const state = createState([folder], { selectionMode: true });
    render(FolderRowWrapper, { state, folder });

    const checkbox = page.getByRole('checkbox', { name: 'Select backup' });
    await expect.element(checkbox).toBeInTheDocument();
    await expect.element(checkbox).not.toBeDisabled();
  });

  it('should have disabled checkbox when showCheckboxes is false', async () => {
    const folder = makeFolder('backup/');
    const state = createState([folder]);
    render(FolderRowWrapper, { state, folder });

    const checkbox = page.getByRole('checkbox', { name: 'Select backup' });
    await expect.element(checkbox).toBeDisabled();
  });

  it('should highlight row when selected', async () => {
    const folder = makeFolder('selected/');
    const state = createState([folder], { selectedKeys: ['selected/'], selectionMode: true });
    render(FolderRowWrapper, { state, folder });

    const row = page.getByRole('row');
    await expect.element(row).toHaveClass(/bg-primary/);
  });

  it('should have aria-label on actions button', async () => {
    const folder = makeFolder('my-folder/');
    const state = createState([folder]);
    render(FolderRowWrapper, { state, folder });

    const btn = page.getByRole('button', { name: 'Actions for my-folder' });
    await expect.element(btn).toBeInTheDocument();
  });

  describe('edge cases', () => {
    it('should handle folder names with special characters', async () => {
      const folder = makeFolder('path/my folder (2)/');
      const state = createState([folder]);
      render(FolderRowWrapper, { state, folder });
      await expect.element(page.getByText('my folder (2)')).toBeInTheDocument();
    });

    it('should handle deeply nested folders', async () => {
      const folder = makeFolder('a/b/c/d/e/deep-folder/');
      const state = createState([folder]);
      render(FolderRowWrapper, { state, folder });
      await expect.element(page.getByText('deep-folder')).toBeInTheDocument();
    });

    it('should handle unicode folder names', async () => {
      const folder = makeFolder('données/résumés/');
      const state = createState([folder]);
      render(FolderRowWrapper, { state, folder });
      await expect.element(page.getByText('résumés')).toBeInTheDocument();
    });
  });
});
