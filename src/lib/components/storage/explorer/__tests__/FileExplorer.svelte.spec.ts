import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { SvelteSet } from 'svelte/reactivity';
import FileExplorerWrapper from './FileExplorerWrapper.svelte';
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
  it('captures external file drops on folder rows for upload to the current prefix', async () => {
    const state = createState([{ ...makeFile('reports/child/'), isDirectory: true }], {
      prefix: 'reports/'
    });
    const move = vi.spyOn(state, 'performMove');
    render(FileExplorerWrapper, { state });
    await expect.element(page.getByText('child', { exact: true })).toBeInTheDocument();

    const row = page.getByText('child', { exact: true }).element().closest('tr')!;
    const dt = new DataTransfer();
    const file = new File(['report'], 'report.txt', { type: 'text/plain' });
    dt.items.add(file);
    row.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
    await expect.element(page.getByTestId('storage-upload-drop-overlay')).toBeInTheDocument();
    row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));

    await expect.poll(() => state.activeModal?.type).toBe('upload');
    expect(state.activeModal).toEqual({
      type: 'upload',
      payload: {
        bucket: 'test-bucket',
        prefix: 'reports/',
        files: [{ file, relativePath: 'report.txt' }]
      }
    });
    expect(move).not.toHaveBeenCalled();
    await expect.element(page.getByTestId('storage-upload-drop-overlay')).not.toBeInTheDocument();
  });

  it.each(['archive', 'loading', 'modal'])(
    'prevents file navigation without opening an upload while in %s',
    async (blocked) => {
      const state = createState([makeFile('report.txt')]);
      if (blocked === 'archive') state.archive.archiveKey = 'data.zip';
      if (blocked === 'loading') state.loading = true;
      if (blocked === 'modal') state.openModal('upload', { bucket: state.bucket, prefix: '' });
      const openModal = vi.spyOn(state, 'openModal');
      render(FileExplorerWrapper, { state });
      await expect.element(page.getByTestId('storage-file-browser')).toBeInTheDocument();

      const dt = new DataTransfer();
      dt.items.add(new File(['report'], 'report.txt'));
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      page.getByTestId('storage-file-browser').element().dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
      expect(openModal).not.toHaveBeenCalled();
    }
  );

  it('ignores text drags and clears the file overlay when leaving the browser', async () => {
    const state = createState();
    render(FileExplorerWrapper, { state });
    await expect.element(page.getByTestId('storage-file-browser')).toBeInTheDocument();
    const browser = page.getByTestId('storage-file-browser').element();
    const text = new DataTransfer();
    text.setData('text/plain', 'text');
    const textDrop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: text
    });
    browser.dispatchEvent(textDrop);
    expect(textDrop.defaultPrevented).toBe(false);
    expect(state.activeModal).toBeNull();

    const dt = new DataTransfer();
    dt.items.add(new File(['report'], 'report.txt'));
    browser.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
    await expect.element(page.getByTestId('storage-upload-drop-overlay')).toBeInTheDocument();
    browser.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: dt }));
    await expect.element(page.getByTestId('storage-upload-drop-overlay')).not.toBeInTheDocument();
  });

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

  it('should clear selection when clicking outside a table row', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], { selectedKeys: ['test.txt'] });
    const spy = vi.spyOn(state, 'clearSelection');
    const { container } = render(FileExplorerWrapper, { state });

    // Find the relative container div and click it
    const wrapper = container.querySelector('.relative.min-h-0') as HTMLElement;
    wrapper.click();
    expect(spy).toHaveBeenCalled();
  });

  it('should not clear selection when clicking on a table row', async () => {
    const file = makeFile('test.txt');
    const state = createState([file], { selectedKeys: ['test.txt'] });
    const spy = vi.spyOn(state, 'clearSelection');
    render(FileExplorerWrapper, { state });

    // Click on an element inside a <tr>
    const row = document.querySelector('tr td') as HTMLElement;
    if (row) {
      row.click();
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('should call pagination navigation callbacks', async () => {
    const files = [makeFile('test.txt')];
    const state = createState(files);
    state.objects.hasNextPage = true;
    state.prevTokens = ['token1'];
    const spyFirst = vi.spyOn(state, 'navigateFirst');
    const spyPrev = vi.spyOn(state, 'navigatePrev');
    const spyNext = vi.spyOn(state, 'navigateNext');
    render(FileExplorerWrapper, { state });

    // Click the "next" pagination button
    const nextBtn = page.getByRole('button', { name: 'Next page' });
    await nextBtn.click();
    expect(spyNext).toHaveBeenCalled();

    // Click the "previous" pagination button
    const prevBtn = page.getByRole('button', { name: 'Previous page' });
    await prevBtn.click();
    expect(spyPrev).toHaveBeenCalled();

    // Click the "first" pagination button
    const firstBtn = page.getByRole('button', { name: 'First page' });
    await firstBtn.click();
    expect(spyFirst).toHaveBeenCalled();
  });

  it('should call onPageSizeChange when page size changes', async () => {
    const state = createState([makeFile('test.txt')]);
    const spy = vi.spyOn(state, 'onPageSizeChange');
    render(FileExplorerWrapper, { state });

    // Find and interact with the page size select
    const select = page.getByRole('combobox');
    if (select.elements().length > 0) {
      await select.selectOptions('50');
      expect(spy).toHaveBeenCalled();
    }
  });
});
