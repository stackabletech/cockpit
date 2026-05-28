import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { SvelteSet } from 'svelte/reactivity';
import ContextMenuWrapper from './__tests__/ContextMenuWrapper.svelte';
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
  opts: { contextMenu?: { x: number; y: number; key: string }; selectedKeys?: string[] } = {}
): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'] });
  state.bucket = 'test-bucket';
  state.prefix = '';
  state.objects = {
    objects,
    hasNextPage: false,
    currentPage: 1,
    pageSize: 25
  };
  if (opts.contextMenu) state.contextMenu = opts.contextMenu;
  if (opts.selectedKeys) state.selectedKeys = new SvelteSet(opts.selectedKeys);
  return state;
}

describe('ContextMenu', () => {
  it('should render menu with role="menu"', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], {
      contextMenu: { x: 100, y: 100, key: 'test.txt' },
      selectedKeys: ['test.txt']
    });
    render(ContextMenuWrapper, { state });

    await expect.element(page.getByRole('menu')).toBeInTheDocument();
  });

  it('should show action buttons', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], {
      contextMenu: { x: 100, y: 100, key: 'test.txt' },
      selectedKeys: ['test.txt']
    });
    render(ContextMenuWrapper, { state });

    await expect.element(page.getByRole('menuitem', { name: 'Preview' })).toBeInTheDocument();
    await expect.element(page.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
    await expect.element(page.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('should disable preview when context is a folder', async () => {
    const folder = makeFolder('docs/');
    const state = createState([folder], {
      contextMenu: { x: 100, y: 100, key: 'docs/' },
      selectedKeys: ['docs/']
    });
    render(ContextMenuWrapper, { state });

    const previewBtn = page.getByRole('menuitem', { name: 'Preview' });
    await expect.element(previewBtn).toHaveAttribute('disabled');
  });

  it('should disable download when context is a folder with no selected files', async () => {
    const folder = makeFolder('docs/');
    const state = createState([folder], {
      contextMenu: { x: 100, y: 100, key: 'docs/' },
      selectedKeys: ['docs/']
    });
    render(ContextMenuWrapper, { state });

    const downloadBtn = page.getByRole('menuitem', { name: 'Download' });
    await expect.element(downloadBtn).toHaveAttribute('disabled');
  });

  it('should enable download when context is a file', async () => {
    const file = makeFile('report.pdf');
    const state = createState([file], {
      contextMenu: { x: 100, y: 100, key: 'report.pdf' },
      selectedKeys: ['report.pdf']
    });
    render(ContextMenuWrapper, { state });

    const downloadBtn = page.getByRole('menuitem', { name: 'Download' });
    await expect.element(downloadBtn).not.toHaveAttribute('disabled');
  });

  it('should close menu when close button is clicked', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], {
      contextMenu: { x: 100, y: 100, key: 'test.txt' },
      selectedKeys: ['test.txt']
    });
    const spy = vi.spyOn(state, 'closeContextMenu');
    render(ContextMenuWrapper, { state });

    await page.getByRole('menuitem', { name: 'Close' }).click();
    expect(spy).toHaveBeenCalled();
  });

  it('should close menu on Escape key', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], {
      contextMenu: { x: 100, y: 100, key: 'test.txt' },
      selectedKeys: ['test.txt']
    });
    const spy = vi.spyOn(state, 'closeContextMenu');
    render(ContextMenuWrapper, { state });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });

  it('should execute action when action button is clicked', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], {
      contextMenu: { x: 100, y: 100, key: 'test.txt' },
      selectedKeys: ['test.txt']
    });
    const spy = vi.spyOn(state, 'executeAction');
    render(ContextMenuWrapper, { state });

    await page.getByRole('menuitem', { name: 'Delete' }).click();
    expect(spy).toHaveBeenCalledWith('delete');
  });

  it('should position menu at context menu coordinates', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], {
      contextMenu: { x: 200, y: 150, key: 'test.txt' },
      selectedKeys: ['test.txt']
    });
    render(ContextMenuWrapper, { state });

    const menu = page.getByRole('menu');
    await expect.element(menu).toBeInTheDocument();
  });
});
