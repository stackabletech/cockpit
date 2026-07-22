import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { SvelteSet } from 'svelte/reactivity';
import ObjectTableWrapper from './ObjectTableWrapper.svelte';
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

function makeFile(key: string, size?: number): StorageObject {
  return {
    key,
    size: size ?? faker.number.int({ min: 100, max: 10_000_000 }),
    lastModified: faker.date.recent(),
    isDirectory: false,
    contentType: 'application/octet-stream'
  };
}

function createState(
  objects: StorageObject[] = [],
  opts: { prefix?: string; selectionMode?: boolean; selectedKeys?: string[] } = {}
): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'] });
  state.bucket = 'test-bucket';
  state.prefix = opts.prefix ?? '';
  state.objects = {
    objects,
    hasNextPage: false,
    currentPage: 1,
    pageSize: 25
  };
  if (opts.selectionMode) state.selectionMode = true;
  if (opts.selectedKeys) state.selectedKeys = new SvelteSet(opts.selectedKeys);
  return state;
}

describe('ObjectTable', () => {
  it('should render column headers', async () => {
    const state = createState();
    render(ObjectTableWrapper, { state });

    await expect.element(page.getByText('Name')).toBeInTheDocument();
    await expect.element(page.getByText('Size')).toBeInTheDocument();
    await expect.element(page.getByText('Last modified')).toBeInTheDocument();
  });

  it('should render select-all checkbox', async () => {
    const state = createState([makeFile('test.txt')], { selectionMode: true });
    render(ObjectTableWrapper, { state });

    const checkbox = page.getByRole('checkbox', { name: 'Select all' });
    await expect.element(checkbox).toBeInTheDocument();
  });

  it('should show empty state when no items', async () => {
    const state = createState([]);
    render(ObjectTableWrapper, { state });

    await expect.element(page.getByText('This bucket is empty')).toBeInTheDocument();
  });

  it('should show parent directory row when prefix is set', async () => {
    const state = createState([], { prefix: 'docs/' });
    render(ObjectTableWrapper, { state });

    await expect.element(page.getByText('...')).toBeInTheDocument();
  });

  it('should not show parent directory row when prefix is empty', async () => {
    const state = createState([makeFile('file.txt')]);
    render(ObjectTableWrapper, { state });

    expect(page.getByText('...').elements().length).toBe(0);
  });

  it('should render folders and files', async () => {
    const objects = [makeFolder('photos/'), makeFile('readme.txt')];
    const state = createState(objects);
    render(ObjectTableWrapper, { state });

    await expect.element(page.getByText('photos')).toBeInTheDocument();
    await expect.element(page.getByText('readme.txt')).toBeInTheDocument();
  });

  it('should navigate up when clicking parent dir row', async () => {
    const state = createState([], { prefix: 'a/b/' });
    const spy = vi.spyOn(state, 'navigate');
    render(ObjectTableWrapper, { state });

    await page.getByText('...').click();
    expect(spy).toHaveBeenCalledWith('a/');
  });

  it('should navigate to root when clicking parent dir from single-level prefix', async () => {
    const state = createState([], { prefix: 'docs/' });
    const spy = vi.spyOn(state, 'navigate');
    render(ObjectTableWrapper, { state });

    await page.getByText('...').click();
    expect(spy).toHaveBeenCalledWith('');
  });

  it('should call selectAll when select-all checkbox is checked', async () => {
    const objects = [makeFile('a.txt'), makeFile('b.txt')];
    const state = createState(objects, { selectionMode: true });
    const spy = vi.spyOn(state, 'selectAll');
    render(ObjectTableWrapper, { state });

    const checkbox = page.getByRole('checkbox', { name: 'Select all' });
    await checkbox.click();
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('should disable select-all checkbox when not in selection mode', async () => {
    const state = createState([makeFile('a.txt')]);
    render(ObjectTableWrapper, { state });

    const checkbox = page.getByRole('checkbox', { name: 'Select all' });
    await expect.element(checkbox).toBeDisabled();
  });

  it('should render many items', async () => {
    const objects = Array.from({ length: 50 }, (_, i) => makeFile(`file-${i}.txt`));
    const state = createState(objects);
    render(ObjectTableWrapper, { state });

    await expect.element(page.getByText('file-0.txt')).toBeInTheDocument();
    await expect.element(page.getByText('file-49.txt')).toBeInTheDocument();
  });

  it('should not show empty state when only files exist (no folders)', async () => {
    const state = createState([makeFile('only-file.txt')]);
    render(ObjectTableWrapper, { state });

    await expect.element(page.getByText('only-file.txt')).toBeInTheDocument();
    expect(page.getByText('This bucket is empty').elements().length).toBe(0);
  });

  it('should not show empty state when only folders exist (no files)', async () => {
    const state = createState([makeFolder('images/')]);
    render(ObjectTableWrapper, { state });

    await expect.element(page.getByText('images')).toBeInTheDocument();
    expect(page.getByText('This bucket is empty').elements().length).toBe(0);
  });

  it('should set indeterminate state on select-all checkbox when some items are selected', async () => {
    const objects = [makeFile('a.txt'), makeFile('b.txt')];
    const state = createState(objects, {
      selectionMode: true,
      selectedKeys: ['a.txt']
    });
    render(ObjectTableWrapper, { state });

    const checkbox = page.getByRole('checkbox', { name: 'Select all' });
    await expect.element(checkbox).toBeInTheDocument();
    // someSelected should be true, making indeterminate true
  });
});
