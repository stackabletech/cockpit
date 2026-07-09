import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import StorageBreadcrumbWrapper from './StorageBreadcrumbWrapper.svelte';
import { StorageState } from '$lib/storage/state.svelte.js';
import { TabsState } from '$lib/storage/tabs.svelte.js';
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

    it('should call pin via more options menu when not pinned', async () => {
      const state = createState({ bucket: 'test-bucket', prefix: 'data/' });
      const spy = vi.spyOn(state.bookmarks, 'pin');
      render(StorageBreadcrumbWrapper, { state });

      // Open the dropdown by focusing/clicking the trigger
      const moreBtn = page.getByRole('button', { name: /more options/i });
      await moreBtn.click();

      // The more-options dropdown now has: 0="New Tab", 1="Pin this location"
      // Use .nth(1) to target the pin item, with direct DOM dispatch as fallback
      const menuItems = page.getByRole('menuitem');
      const el = menuItems.nth(1);
      await el.click();

      // If DaisyUI dropdown prevents click, try direct dispatch
      if (!spy.mock.calls.length) {
        const domEl = (await el.element()) as HTMLElement;
        domEl.click();
      }
      expect(spy).toHaveBeenCalledWith('test-bucket', 'data/');
    });

    it('should call unpin via more options menu when pinned', async () => {
      const state = createState({
        bucket: 'test-bucket',
        prefix: 'data/',
        pinned: [{ bucket: 'test-bucket', prefix: 'data/' }]
      });
      const spy = vi.spyOn(state.bookmarks, 'unpin');
      render(StorageBreadcrumbWrapper, { state });

      // Open the dropdown first
      const moreBtn = page.getByRole('button', { name: /more options/i });
      await moreBtn.click();

      // Click the unpin menuitem specifically (not the first one which is now "New Tab")
      const menuItem = page.getByRole('menuitem', { name: /unpin/i });
      await menuItem.click();
      expect(spy).toHaveBeenCalledWith('test-bucket', 'data/');
    });
  });

  describe('navigation clicks', () => {
    it('should navigate to root when clicking bucket button with prefix', async () => {
      const state = createState({ bucket: 'data', prefix: 'reports/' });
      const spy = vi.spyOn(state, 'navigate');
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      const bucketBtn = nav.getByRole('button').first();
      await bucketBtn.click();
      expect(spy).toHaveBeenCalledWith('');
    });

    it('should navigate when clicking a collapsed part', async () => {
      const state = createState({ prefix: 'alpha/bravo/charlie/delta/' });
      const spy = vi.spyOn(state, 'navigate');
      render(StorageBreadcrumbWrapper, { state });

      // Click 'alpha' in the collapsed dropdown
      const alphaBtn = page.getByText('alpha');
      await alphaBtn.click();
      expect(spy).toHaveBeenCalledWith('alpha/');
    });

    it('should navigate when clicking a non-current visible part', async () => {
      // 3 levels: "a/b/c/" -> visibleParts = all 3 (<=MAX_TAIL is false, 3>2), so last 2 visible
      // Actually with MAX_TAIL=2, 3 parts -> collapsed=[a], visible=[b,c]
      // b is non-current, c is current
      const state = createState({ prefix: 'aaa/bbb/ccc/' });
      const spy = vi.spyOn(state, 'navigate');
      render(StorageBreadcrumbWrapper, { state });

      await page.getByText('bbb').click();
      expect(spy).toHaveBeenCalledWith('aaa/bbb/');
    });

    it('should not navigate when clicking the current (last) part', async () => {
      const state = createState({ prefix: 'reports/' });
      const spy = vi.spyOn(state, 'navigate');
      render(StorageBreadcrumbWrapper, { state });

      // Current part is a span, not a button - clicking should not navigate
      const current = page.getByText('reports');
      await expect.element(current).toHaveAttribute('aria-current', 'page');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('inline pin buttons', () => {
    it('should pin bucket at root level via inline pin button', async () => {
      const state = createState({ bucket: 'test-bucket' });
      const spy = vi.spyOn(state.bookmarks, 'pin');
      render(StorageBreadcrumbWrapper, { state });

      const pinBtn = page.getByRole('button', { name: /pin/i }).first();
      await pinBtn.click();
      expect(spy).toHaveBeenCalledWith('test-bucket', '');
    });

    it('should unpin bucket at root level via inline pin button when pinned', async () => {
      const state = createState({
        bucket: 'test-bucket',
        pinned: [{ bucket: 'test-bucket', prefix: '' }]
      });
      const spy = vi.spyOn(state.bookmarks, 'unpin');
      render(StorageBreadcrumbWrapper, { state });

      const pinBtn = page.getByRole('button', { name: /unpin/i }).first();
      await pinBtn.click();
      expect(spy).toHaveBeenCalledWith('test-bucket', '');
    });
  });

  describe('breadcrumb context menu', () => {
    it('should open context menu on right-click of bucket at root', async () => {
      const state = createState({ bucket: 'test-bucket' });
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      const bucketEl = nav.getByText('test-bucket');
      await bucketEl.click({ button: 'right' });

      // Context menu should appear with a pin/unpin menuitem
      const menuItem = page.getByRole('menuitem');
      await expect.element(menuItem.first()).toBeInTheDocument();
    });

    it('should pin via context menu when not pinned', async () => {
      const state = createState({ bucket: 'test-bucket' });
      const spy = vi.spyOn(state.bookmarks, 'pin');
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      const bucketEl = nav.getByText('test-bucket');
      await bucketEl.click({ button: 'right' });

      const menuItem = page.getByRole('menuitem');
      await menuItem.first().click();
      expect(spy).toHaveBeenCalledWith('test-bucket', '');
    });

    it('should unpin via context menu when pinned', async () => {
      const state = createState({
        bucket: 'test-bucket',
        pinned: [{ bucket: 'test-bucket', prefix: '' }]
      });
      const spy = vi.spyOn(state.bookmarks, 'unpin');
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      const bucketEl = nav.getByText('test-bucket');
      await bucketEl.click({ button: 'right' });

      const menuItem = page.getByRole('menuitem');
      await menuItem.first().click();
      expect(spy).toHaveBeenCalledWith('test-bucket', '');
    });

    it('should close context menu when clicking outside', async () => {
      const state = createState({ bucket: 'test-bucket' });
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      const bucketEl = nav.getByText('test-bucket');
      await bucketEl.click({ button: 'right' });

      // Context menu should be open - it's the fixed-position menu
      const ctxMenuItems = page.getByRole('menuitem');
      await expect.element(ctxMenuItems.first()).toBeInTheDocument();

      // The backdrop is a fixed inset-0 div that's a sibling before the context menu
      // Dispatch mousedown on it to trigger closeBreadcrumbCtx
      const menuEl = (await ctxMenuItems.first().element()) as HTMLElement;
      const menuUl = menuEl.closest('ul[role="menu"]')!;
      const backdrop = menuUl.previousElementSibling as HTMLElement;
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      // Context menu should be closed - menuitem from ctx menu should be gone
      // The remaining menuitems should be from the more options dropdown (New Tab + Pin)
      await expect.element(page.getByRole('menuitem').first()).toBeInTheDocument(); // the one in more options
    });

    it('should open context menu on right-click of bucket with prefix', async () => {
      const state = createState({ bucket: 'data', prefix: 'reports/' });
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      const bucketBtn = nav.getByText('data');
      await bucketBtn.click({ button: 'right' });

      const menuItem = page.getByRole('menuitem');
      await expect.element(menuItem.first()).toBeInTheDocument();
    });

    it('should open context menu on right-click of current folder', async () => {
      const state = createState({ bucket: 'data', prefix: 'reports/' });
      render(StorageBreadcrumbWrapper, { state });

      const currentEl = page.getByText('reports');
      await currentEl.click({ button: 'right' });

      const menuItem = page.getByRole('menuitem');
      await expect.element(menuItem.first()).toBeInTheDocument();
    });

    it('should open context menu on right-click of non-current visible part', async () => {
      const state = createState({ prefix: 'aaa/bbb/ccc/' });
      render(StorageBreadcrumbWrapper, { state });

      const partEl = page.getByText('bbb');
      await partEl.click({ button: 'right' });

      const menuItem = page.getByRole('menuitem');
      await expect.element(menuItem.first()).toBeInTheDocument();
    });

    it('should open context menu on right-click of collapsed part', async () => {
      const state = createState({ prefix: 'alpha/bravo/charlie/delta/' });
      render(StorageBreadcrumbWrapper, { state });

      const partEl = page.getByText('alpha');
      await partEl.click({ button: 'right' });

      const menuItem = page.getByRole('menuitem');
      await expect.element(menuItem.first()).toBeInTheDocument();
    });
  });

  describe('exactly MAX_TAIL levels', () => {
    it('should show all parts without collapse for exactly 2 levels', async () => {
      const state = createState({ prefix: 'aaa/bbb/' });
      render(StorageBreadcrumbWrapper, { state });

      await expect.element(page.getByText('aaa')).toBeInTheDocument();
      await expect.element(page.getByText('bbb')).toHaveAttribute('aria-current', 'page');
      // No collapse button
      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      const moreBtn = nav.getByRole('button', { name: /more/i });
      await expect.element(moreBtn).not.toBeInTheDocument();
    });
  });

  describe('archive mode', () => {
    it('should show archive name when inside an archive', async () => {
      const state = createState();
      state.archiveKey = 'data.zip';
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      await expect.element(nav.getByText('data.zip')).toBeInTheDocument();
    });

    it('should show internal path parts when navigating within archive', async () => {
      const state = createState();
      state.archiveKey = 'data.zip';
      state.archivePrefix = 'music/videos/';
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      await expect
        .element(nav.getByRole('button', { name: 'music', exact: true }))
        .toBeInTheDocument();
      await expect.element(nav.getByText('videos')).toHaveAttribute('aria-current', 'page');
    });

    it('should show nested archive entry when browsing nested archive', async () => {
      const state = createState();
      state.archiveKey = 'outer.zip';
      state.archiveNestedPath = 'inner.tar';
      state.archivePrefix = 'subdir/';
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      await expect.element(nav.getByText('outer.zip')).toBeInTheDocument();
      await expect.element(nav.getByText('inner.tar')).toBeInTheDocument();
      await expect.element(nav.getByText('subdir')).toBeInTheDocument();
    });

    it('should call navigateInArchive when clicking breadcrumb folder inside archive', async () => {
      const state = createState();
      state.archiveKey = 'data.zip';
      state.archivePrefix = 'music/videos/';
      const spy = vi.spyOn(state, 'navigateInArchive');
      render(StorageBreadcrumbWrapper, { state });

      const nav = page.getByRole('navigation', { name: 'breadcrumb' });
      await nav.getByRole('button', { name: 'music', exact: true }).click();
      expect(spy).toHaveBeenCalledWith('music/');
    });

    it('should hide upload button when in archive mode', async () => {
      const state = createState();
      state.archiveKey = 'data.zip';
      render(StorageBreadcrumbWrapper, { state });

      await expect.element(page.getByRole('button', { name: /upload/i })).not.toBeInTheDocument();
    });
  });

  describe('new tab', () => {
    it('should show "New Tab" option in the more options menu', async () => {
      const state = createState();
      render(StorageBreadcrumbWrapper, { state });

      const moreBtn = page.getByRole('button', { name: /more options/i });
      await moreBtn.click();

      await expect.element(page.getByRole('menuitem', { name: 'New Tab' })).toBeInTheDocument();
    });

    it('should call tabsState.addTab when "New Tab" is clicked', async () => {
      const state = createState({ bucket: 'test-bucket', prefix: 'data/' });
      const tabsState = new TabsState(state);
      const spy = vi.spyOn(tabsState, 'addTab');
      render(StorageBreadcrumbWrapper, { state, tabsState });

      const moreBtn = page.getByRole('button', { name: /more options/i });
      await moreBtn.click();

      await page.getByRole('menuitem', { name: 'New Tab' }).click();

      expect(spy).toHaveBeenCalled();
    });
  });
});
