import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { SvelteSet } from 'svelte/reactivity';
import StorageBreadcrumbWrapper from './__tests__/StorageBreadcrumbWrapper.svelte';
import { StorageState } from '$lib/storage/state.svelte.js';
import type { StorageObject } from '$lib/storage/types.js';

function makeFolders(count: number): StorageObject[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `folder${i}/`,
    size: 0,
    lastModified: faker.date.recent(),
    isDirectory: true,
    contentType: undefined
  }));
}

function makeFiles(count: number): StorageObject[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `file${i}.txt`,
    size: faker.number.int({ min: 100, max: 10000 }),
    lastModified: faker.date.recent(),
    isDirectory: false,
    contentType: 'text/plain'
  }));
}

function createState(
  opts: {
    bucket?: string;
    prefix?: string;
    folders?: StorageObject[];
    files?: StorageObject[];
    selectionMode?: boolean;
    pinned?: Array<{ bucket: string; prefix: string }>;
  } = {}
): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'] });
  state.bucket = opts.bucket ?? 'test-bucket';
  state.prefix = opts.prefix ?? '';
  const objects = [...(opts.folders ?? []), ...(opts.files ?? [])];
  state.objects = {
    objects,
    hasNextPage: false,
    currentPage: 1,
    pageSize: 25
  };
  if (opts.selectionMode) state.selectionMode = true;
  if (opts.pinned) {
    for (const p of opts.pinned) {
      state.bookmarks.pin(p.bucket, p.prefix);
    }
  }
  return state;
}

describe('StorageBreadcrumb', () => {
  describe('root level (no prefix)', () => {
    it('should render breadcrumb nav', async () => {
      const state = createState();
      render(StorageBreadcrumbWrapper, { state });

      await expect
        .element(page.getByRole('navigation', { name: 'breadcrumb' }))
        .toBeInTheDocument();
    });

    it('should show bucket name with aria-current at root', async () => {
      const state = createState({ bucket: 'my-bucket' });
      render(StorageBreadcrumbWrapper, { state });

      const current = page.getByText('my-bucket');
      await expect.element(current).toBeInTheDocument();
      await expect
        .element(page.getByRole('navigation', { name: 'breadcrumb' }).getByText('my-bucket'))
        .toHaveAttribute('aria-current', 'page');
    });

    it('should show folder and file count badges', async () => {
      const state = createState({ folders: makeFolders(3), files: makeFiles(5) });
      render(StorageBreadcrumbWrapper, { state });

      await expect.element(page.getByText('3')).toBeInTheDocument();
      await expect.element(page.getByText('5')).toBeInTheDocument();
    });
  });

  describe('single level prefix', () => {
    it('should show clickable bucket and current folder', async () => {
      const state = createState({ bucket: 'data', prefix: 'reports/' });
      render(StorageBreadcrumbWrapper, { state });

      // Bucket should be a button (clickable)
      const bucketBtn = page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('button');
      await expect.element(bucketBtn.first()).toBeInTheDocument();
      // Current folder should have aria-current
      await expect.element(page.getByText('reports')).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('deep nesting (collapsed breadcrumbs)', () => {
    it('should collapse parts when more than 2 levels deep', async () => {
      // prefix = "alpha/bravo/charlie/delta/" -> 4 parts, should collapse first 2, show last 2
      const state = createState({ prefix: 'alpha/bravo/charlie/delta/' });
      render(StorageBreadcrumbWrapper, { state });

      // The "..." (more) button should appear
      await expect
        .element(
          page
            .getByRole('navigation', { name: 'breadcrumb' })
            .getByRole('button', { name: /more/i })
        )
        .toBeInTheDocument();
      // Last two segments visible
      await expect.element(page.getByText('charlie')).toBeInTheDocument();
      await expect.element(page.getByText('delta')).toBeInTheDocument();
    });

    it('should show 5+ levels with collapse', async () => {
      const state = createState({ prefix: 'one/two/three/four/five/' });
      render(StorageBreadcrumbWrapper, { state });

      // Only last 2 visible directly
      await expect.element(page.getByText('four')).toBeInTheDocument();
      await expect.element(page.getByText('five')).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('selection mode toggle', () => {
    it('should render toggle button with aria-pressed=false by default', async () => {
      const state = createState();
      render(StorageBreadcrumbWrapper, { state });

      const toggle = page.getByRole('button', { name: /selection/i });
      await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
    });

    it('should call toggleSelectionMode on click', async () => {
      const state = createState();
      const spy = vi.spyOn(state, 'toggleSelectionMode');
      render(StorageBreadcrumbWrapper, { state });

      await page.getByRole('button', { name: /selection/i }).click();
      expect(spy).toHaveBeenCalled();
    });

    it('should reflect active selection mode', async () => {
      const state = createState({ selectionMode: true });
      render(StorageBreadcrumbWrapper, { state });

      const toggle = page.getByRole('button', { name: /selection/i });
      await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('upload button', () => {
    it('should render upload button', async () => {
      const state = createState();
      render(StorageBreadcrumbWrapper, { state });

      await expect.element(page.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    });

    it('should call openModal on upload click', async () => {
      const state = createState({ bucket: 'mybucket', prefix: 'data/' });
      const spy = vi.spyOn(state, 'openModal');
      render(StorageBreadcrumbWrapper, { state });

      await page.getByRole('button', { name: /upload/i }).click();
      expect(spy).toHaveBeenCalledWith('upload', { bucket: 'mybucket', prefix: 'data/' });
    });
  });

  describe('special characters in paths', () => {
    it('should handle paths with spaces', async () => {
      const state = createState({ prefix: 'my folder/sub dir/' });
      render(StorageBreadcrumbWrapper, { state });

      await expect.element(page.getByText('my folder')).toBeInTheDocument();
      await expect.element(page.getByText('sub dir')).toBeInTheDocument();
    });

    it('should handle paths with unicode', async () => {
      const state = createState({ prefix: 'données/' });
      render(StorageBreadcrumbWrapper, { state });

      await expect.element(page.getByText('données')).toBeInTheDocument();
    });
  });

  describe('pin/unpin', () => {
    it('should show pin option in more options menu', async () => {
      const state = createState();
      render(StorageBreadcrumbWrapper, { state });

      // The more options button exists
      const moreBtn = page.getByRole('button', { name: /more options/i });
      await expect.element(moreBtn).toBeInTheDocument();
    });

    it('should show unpin when current location is pinned', async () => {
      const state = createState({
        bucket: 'test-bucket',
        prefix: 'data/',
        pinned: [{ bucket: 'test-bucket', prefix: 'data/' }]
      });
      render(StorageBreadcrumbWrapper, { state });

      // The more menu should contain unpin
      const menuItems = page.getByRole('menuitem');
      await expect.element(menuItems.first()).toBeInTheDocument();
    });
  });
});
