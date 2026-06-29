import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { SvelteSet } from 'svelte/reactivity';
import FileRowWrapper from './__tests__/FileRowWrapper.svelte';
import type { StorageObject } from '$lib/storage/types.js';
import { StorageState } from '$lib/storage/state.svelte.js';

function makeFile(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    key: overrides.key ?? `folder/${faker.system.fileName()}`,
    size: overrides.size ?? faker.number.int({ min: 0, max: 1_000_000_000 }),
    lastModified: overrides.lastModified ?? faker.date.recent(),
    isDirectory: false,
    contentType:
      overrides.contentType ??
      faker.helpers.arrayElement([
        'image/png',
        'application/pdf',
        'application/json',
        'application/zip',
        'text/plain',
        undefined
      ])
  };
}

function createState(
  files: StorageObject[] = [],
  opts: { selectionMode?: boolean; selectedKeys?: string[] } = {}
): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'] });
  state.bucket = 'test-bucket';
  state.prefix = '';
  state.objects = {
    objects: files,
    hasNextPage: false,
    currentPage: 1,
    pageSize: 25
  };
  if (opts.selectionMode) state.selectionMode = true;
  if (opts.selectedKeys) state.selectedKeys = new SvelteSet(opts.selectedKeys);
  return state;
}

describe('FileRow', () => {
  it('should render the file name', async () => {
    const file = makeFile({ key: 'docs/report.pdf', contentType: 'application/pdf' });
    const state = createState([file]);
    render(FileRowWrapper, { state, file });

    await expect.element(page.getByText('report.pdf')).toBeInTheDocument();
  });

  it('should render the file size', async () => {
    const file = makeFile({ key: 'test.txt', size: 1024, contentType: 'text/plain' });
    const state = createState([file]);
    render(FileRowWrapper, { state, file });

    await expect.element(page.getByText(/1.*kB/)).toBeInTheDocument();
  });

  it('should render content type badge', async () => {
    const file = makeFile({ key: 'data.json', contentType: 'application/json' });
    const state = createState([file]);
    render(FileRowWrapper, { state, file });

    await expect.element(page.getByText('json', { exact: true })).toBeInTheDocument();
  });

  it('should not render badge when contentType is undefined', async () => {
    const file = makeFile({ key: 'unknown-file', contentType: undefined });
    const state = createState([file]);
    render(FileRowWrapper, { state, file });

    await expect.element(page.getByText('unknown-file').first()).toBeInTheDocument();
  });

  it('should show checkbox when showCheckboxes is true', async () => {
    const file = makeFile({ key: 'file.txt', contentType: 'text/plain' });
    const state = createState([file], { selectionMode: true });
    render(FileRowWrapper, { state, file });

    const checkbox = page.getByRole('checkbox', { name: 'Select file.txt' });
    await expect.element(checkbox).toBeInTheDocument();
    await expect.element(checkbox).not.toBeDisabled();
  });

  it('should have disabled checkbox when showCheckboxes is false', async () => {
    const file = makeFile({ key: 'file.txt', contentType: 'text/plain' });
    const state = createState([file]);
    render(FileRowWrapper, { state, file });

    const checkbox = page.getByRole('checkbox', { name: 'Select file.txt' });
    await expect.element(checkbox).toBeDisabled();
  });

  it('should highlight row when selected', async () => {
    const file = makeFile({ key: 'selected.txt', contentType: 'text/plain' });
    const state = createState([file], { selectedKeys: ['selected.txt'] });
    render(FileRowWrapper, { state, file });

    const row = page.getByRole('row');
    await expect.element(row).toHaveClass(/bg-primary/);
  });

  it('should have aria-label on actions button', async () => {
    const file = makeFile({ key: 'path/my-file.txt', contentType: 'text/plain' });
    const state = createState([file]);
    render(FileRowWrapper, { state, file });

    const btn = page.getByRole('button', { name: 'Actions for my-file.txt' });
    await expect.element(btn).toBeInTheDocument();
  });

  it('should call toggleSelect on click', async () => {
    const file = makeFile({ key: 'click.txt', contentType: 'text/plain' });
    const state = createState([file]);
    const spy = vi.spyOn(state, 'toggleSelect');
    render(FileRowWrapper, { state, file });

    await page.getByRole('row').click();
    expect(spy).toHaveBeenCalledWith('click.txt', false);
  });

  it('should call executeAction preview on double click', async () => {
    const file = makeFile({ key: 'dbl.txt', contentType: 'text/plain' });
    const state = createState([file]);
    const spy = vi.spyOn(state, 'executeAction');
    render(FileRowWrapper, { state, file });

    await page.getByRole('row').dblClick();
    expect(spy).toHaveBeenCalledWith('preview');
  });

  it('should call openContextMenu on right click', async () => {
    const file = makeFile({ key: 'ctx.txt', contentType: 'text/plain' });
    const state = createState([file]);
    const spy = vi.spyOn(state, 'openContextMenu');
    render(FileRowWrapper, { state, file });

    await page.getByText('ctx.txt').click({ button: 'right' });
    expect(spy).toHaveBeenCalled();
  });

  describe('icon selection based on content type', () => {
    it('should render file with image content type', async () => {
      const file = makeFile({ key: 'holiday-photo.png', contentType: 'image/png' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('holiday-photo.png')).toBeInTheDocument();
      await expect.element(page.getByText('png', { exact: true })).toBeInTheDocument();
    });

    it('should render file with pdf content type', async () => {
      const file = makeFile({ key: 'document.pdf', contentType: 'application/pdf' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('pdf', { exact: true })).toBeInTheDocument();
    });

    it('should render file with code content type', async () => {
      const file = makeFile({ key: 'config.json', contentType: 'application/json' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('json', { exact: true })).toBeInTheDocument();
    });

    it('should render file with archive content type', async () => {
      const file = makeFile({ key: 'backup.zip', contentType: 'application/zip' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('zip', { exact: true })).toBeInTheDocument();
    });
  });

  it('should highlight row when context menu is open for this file', async () => {
    const file = makeFile({ key: 'ctx-active.txt', contentType: 'text/plain' });
    const state = createState([file]);
    state.contextMenu = { x: 100, y: 100, key: 'ctx-active.txt' };
    render(FileRowWrapper, { state, file });

    const row = page.getByRole('row');
    await expect.element(row).toHaveClass(/bg-base-300/);
  });

  it('should call toggleSelect with multi=true on ctrl+click', async () => {
    const file = makeFile({ key: 'ctrl.txt', contentType: 'text/plain' });
    const state = createState([file]);
    const spy = vi.spyOn(state, 'toggleSelect');
    render(FileRowWrapper, { state, file });

    await page.getByRole('row').click({ modifiers: ['ControlOrMeta'] });
    expect(spy).toHaveBeenCalledWith('ctrl.txt', true);
  });

  it('should call toggleSelect on checkbox change', async () => {
    const file = makeFile({ key: 'check.txt', contentType: 'text/plain' });
    const state = createState([file], { selectionMode: true });
    const spy = vi.spyOn(state, 'toggleSelect');
    render(FileRowWrapper, { state, file });

    const checkbox = page.getByRole('checkbox', { name: 'Select check.txt' });
    await checkbox.click();
    expect(spy).toHaveBeenCalledWith('check.txt', true);
  });

  it('should call openContextMenu on actions button click', async () => {
    const file = makeFile({ key: 'actions.txt', contentType: 'text/plain' });
    const state = createState([file]);
    const spy = vi.spyOn(state, 'openContextMenu');
    render(FileRowWrapper, { state, file });

    const btn = page.getByRole('button', { name: 'Actions for actions.txt' });
    await btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('should not highlight as selected when context menu is active', async () => {
    const file = makeFile({ key: 'both.txt', contentType: 'text/plain' });
    const state = createState([file], { selectedKeys: ['both.txt'] });
    state.contextMenu = { x: 0, y: 0, key: 'both.txt' };
    render(FileRowWrapper, { state, file });

    const row = page.getByRole('row');
    await expect.element(row).toHaveClass(/bg-base-300/);
  });

  it('should apply default hover style when neither selected nor context menu', async () => {
    const file = makeFile({ key: 'plain.txt', contentType: 'text/plain' });
    const state = createState([file]);
    render(FileRowWrapper, { state, file });

    const row = page.getByRole('row');
    await expect.element(row).not.toHaveClass(/bg-primary/);
    await expect.element(row).not.toHaveClass(/bg-base-300/);
  });

  describe('edge cases', () => {
    it('should handle zero-byte files', async () => {
      const file = makeFile({ key: 'empty.txt', size: 0, contentType: 'text/plain' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('0 B')).toBeInTheDocument();
    });

    it('should handle very large files', async () => {
      const file = makeFile({ key: 'huge.bin', size: 5_000_000_000_000, contentType: undefined });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText(/[0-9].*TB/)).toBeInTheDocument();
    });

    it('should handle file names with special characters', async () => {
      const name = 'file with spaces & (special).txt';
      const file = makeFile({ key: `path/${name}`, contentType: 'text/plain' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText(name)).toBeInTheDocument();
    });

    it('should handle deeply nested paths', async () => {
      const file = makeFile({ key: 'a/b/c/d/e/f/deep.csv', contentType: 'text/csv' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('deep.csv')).toBeInTheDocument();
    });

    it('should handle contentType with trailing slash gracefully', async () => {
      const file = makeFile({ key: 'weird.bin', contentType: 'application/' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('weird.bin')).toBeInTheDocument();
    });

    it('should handle unicode file names', async () => {
      const file = makeFile({ key: 'données/résumé.txt', contentType: 'text/plain' });
      const state = createState([file]);
      render(FileRowWrapper, { state, file });
      await expect.element(page.getByText('résumé.txt')).toBeInTheDocument();
    });
  });
});
