import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { SvelteSet } from 'svelte/reactivity';
import SelectionToolbarWrapper from './SelectionToolbarWrapper.svelte';
import type { StorageObject } from '$lib/storage/types.js';
import { StorageState } from '$lib/storage/state.svelte.js';

function makeFile(key: string): StorageObject {
  return {
    key,
    size: 1024,
    lastModified: new Date(),
    isDirectory: false,
    contentType: 'text/plain'
  };
}

function makeFolder(key: string): StorageObject {
  return { key, size: 0, lastModified: new Date(), isDirectory: true, contentType: undefined };
}

function createState(objects: StorageObject[] = [], selectedKeys: string[] = []): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'] });
  state.bucket = 'test-bucket';
  state.prefix = '';
  state.objects = { objects, hasNextPage: false, currentPage: 1, pageSize: 25 };
  state.selectedKeys = new SvelteSet(selectedKeys);
  state.selectionMode = true;
  return state;
}

describe('SelectionToolbar', () => {
  it('should show selected count', async () => {
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const state = createState(files, ['a.txt', 'b.txt']);
    render(SelectionToolbarWrapper, { state });

    await expect.element(page.getByText('2 selected')).toBeInTheDocument();
  });

  it('shows the cumulative size of selected files', async () => {
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const state = createState(files, ['a.txt', 'b.txt']);
    render(SelectionToolbarWrapper, { state });

    await expect.element(page.getByText('Selected files: 2.05 kB')).toBeInTheDocument();
  });

  it('should enable preview button when exactly 1 file selected', async () => {
    const files = [makeFile('a.txt')];
    const state = createState(files, ['a.txt']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Preview/ });
    await expect.element(btn).not.toBeDisabled();
  });

  it('should disable preview button when folder is selected', async () => {
    const objects = [makeFile('a.txt'), makeFolder('dir/')];
    const state = createState(objects, ['a.txt', 'dir/']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Preview/ });
    await expect.element(btn).toBeDisabled();
  });

  it('should disable preview when multiple files selected', async () => {
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const state = createState(files, ['a.txt', 'b.txt']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Preview/ });
    await expect.element(btn).toBeDisabled();
  });

  it('should enable download button when exactly 1 file selected', async () => {
    const files = [makeFile('a.txt')];
    const state = createState(files, ['a.txt']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Download/ });
    await expect.element(btn).not.toBeDisabled();
  });

  it('should enable download when folder selected', async () => {
    const objects = [makeFolder('dir/')];
    const state = createState(objects, ['dir/']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Download/ });
    await expect.element(btn).not.toBeDisabled();
  });

  it('should enable download when multiple files are selected', async () => {
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const state = createState(files, ['a.txt', 'b.txt']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Download/ });
    await expect.element(btn).not.toBeDisabled();
  });

  it('should enable delete button when items are selected', async () => {
    const files = [makeFile('a.txt')];
    const state = createState(files, ['a.txt']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Delete/ });
    await expect.element(btn).not.toBeDisabled();
  });

  it('should disable delete button when nothing selected', async () => {
    const state = createState([makeFile('a.txt')], []);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Delete/ });
    await expect.element(btn).toBeDisabled();
  });

  it('should not apply error styling to delete button when nothing selected', async () => {
    const state = createState([makeFile('a.txt')], []);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Delete/ });
    await expect.element(btn).not.toHaveClass('text-error');
  });

  it('should apply error styling to delete button when items are selected', async () => {
    const files = [makeFile('a.txt')];
    const state = createState(files, ['a.txt']);
    render(SelectionToolbarWrapper, { state });

    const btn = page.getByRole('button', { name: /Delete/ });
    await expect.element(btn).toHaveClass('text-error');
  });

  it('should call executeAction preview on preview click', async () => {
    const files = [makeFile('a.txt')];
    const state = createState(files, ['a.txt']);
    const spy = vi.spyOn(state, 'executeAction');
    render(SelectionToolbarWrapper, { state });

    await page.getByRole('button', { name: /Preview/ }).click();
    expect(spy).toHaveBeenCalledWith('preview');
  });

  it('should call executeAction download on download click', async () => {
    const files = [makeFile('a.txt')];
    const state = createState(files, ['a.txt']);
    const spy = vi.spyOn(state, 'executeAction');
    render(SelectionToolbarWrapper, { state });

    await page.getByRole('button', { name: /Download/ }).click();
    expect(spy).toHaveBeenCalledWith('download');
  });

  it('should call executeAction delete on delete click', async () => {
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const state = createState(files, ['a.txt', 'b.txt']);
    const spy = vi.spyOn(state, 'executeAction');
    render(SelectionToolbarWrapper, { state });

    await page.getByRole('button', { name: /Delete/ }).click();
    expect(spy).toHaveBeenCalledWith('delete');
  });
});
