import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { SvelteSet } from 'svelte/reactivity';
import FileExplorerWrapper from './__tests__/FileExplorerWrapper.svelte';
import type { StorageObject } from '$lib/storage/types.js';
import { StorageState } from '$lib/storage/state.svelte.js';

function makeFile(key: string): StorageObject {
  return {
    key,
    size: faker.number.int({ min: 100, max: 10_000_000 }),
    lastModified: faker.date.recent(),
    isDirectory: false,
    contentType: 'application/octet-stream'
  };
}

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
  objects: StorageObject[] = [],
  opts: {
    prefix?: string;
    loading?: boolean;
    deleting?: boolean;
    selectedKeys?: string[];
    contextMenu?: { x: number; y: number; key: string };
  } = {}
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
  if (opts.loading) state.loading = true;
  if (opts.deleting) state.deleting = true;
  if (opts.selectedKeys) state.selectedKeys = new SvelteSet(opts.selectedKeys);
  if (opts.contextMenu) state.contextMenu = opts.contextMenu;
  return state;
}

describe('FileExplorer', () => {
  it('should render the object table', async () => {
    const state = createState([makeFile('hello.txt')]);
    render(FileExplorerWrapper, { state });

    await expect.element(page.getByText('hello.txt')).toBeInTheDocument();
  });

  it('should show loading overlay when loading', async () => {
    const state = createState([], { loading: true });
    render(FileExplorerWrapper, { state });

    await expect.element(page.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('should show loading overlay when deleting', async () => {
    const state = createState([], { deleting: true });
    render(FileExplorerWrapper, { state });

    await expect.element(page.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('should render context menu when contextMenu state is set', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], {
      contextMenu: { x: 100, y: 100, key: 'test.txt' },
      selectedKeys: ['test.txt']
    });
    render(FileExplorerWrapper, { state });

    // The context menu has a specific class w-48
    await expect.element(page.getByText('Actions')).toBeInTheDocument();
  });

  it('should not render context menu actions when contextMenu state is null', async () => {
    const state = createState([makeFile('test.txt')]);
    render(FileExplorerWrapper, { state });

    // Context menu title "Actions" should not be present
    expect(page.getByText('Actions').elements().length).toBe(0);
  });

  it('should render pagination', async () => {
    const state = createState([makeFile('test.txt')]);
    render(FileExplorerWrapper, { state });

    await expect.element(page.getByText('Page 1')).toBeInTheDocument();
  });

  it('should handle Delete key to open delete modal', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], { selectedKeys: ['test.txt'] });
    const spy = vi.spyOn(state, 'openModal');
    render(FileExplorerWrapper, { state });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(spy).toHaveBeenCalledWith('delete', { keys: ['test.txt'] });
  });

  it('should handle Escape key to clear selection', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], { selectedKeys: ['test.txt'] });
    const spy = vi.spyOn(state, 'clearSelection');
    render(FileExplorerWrapper, { state });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });

  it('should render breadcrumb', async () => {
    const state = createState([], { prefix: 'docs/reports/' });
    render(FileExplorerWrapper, { state });

    await expect.element(page.getByText('docs')).toBeInTheDocument();
  });
});
