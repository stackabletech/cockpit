import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import RecentItemsWrapper from './__tests__/RecentItemsWrapper.svelte';
import { StorageState } from '$lib/storage/state.svelte.js';
import type { RecentFile, RecentLocation } from '$lib/storage/types.js';

function makeRecentFile(overrides: Partial<RecentFile> = {}): RecentFile {
  return {
    key: overrides.key ?? `folder/${faker.system.fileName()}`,
    bucket: overrides.bucket ?? 'test-bucket',
    size: overrides.size ?? faker.number.int({ min: 100, max: 1_000_000 }),
    visitedAt: overrides.visitedAt ?? faker.date.recent().toISOString(),
    connectionId: overrides.connectionId ?? 'test-conn-id'
  };
}

function makeRecentLocation(overrides: Partial<RecentLocation> = {}): RecentLocation {
  return {
    bucket: overrides.bucket ?? 'test-bucket',
    prefix: overrides.prefix ?? `${faker.word.noun()}/`,
    visitedAt: overrides.visitedAt ?? faker.date.recent().toISOString(),
    connectionId: overrides.connectionId ?? 'test-conn-id'
  };
}

function createState(
  opts: {
    recentFiles?: RecentFile[];
    recentLocations?: RecentLocation[];
  } = {}
): StorageState {
  const state = new StorageState({
    connected: true,
    buckets: ['test-bucket'],
    connectionId: 'test-conn-id'
  });
  state.bucket = 'test-bucket';
  state.prefix = '';
  if (opts.recentFiles) {
    for (const f of opts.recentFiles) {
      state.bookmarks.recentFiles.push(f);
    }
  }
  if (opts.recentLocations) {
    for (const l of opts.recentLocations) {
      state.bookmarks.recentLocations.push(l);
    }
  }
  return state;
}

describe('RecentItems', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('tab interface', () => {
    it('should render tablist with two tabs', async () => {
      const state = createState();
      render(RecentItemsWrapper, { state });

      await expect.element(page.getByRole('tablist')).toBeInTheDocument();
      const tabs = page.getByRole('tab');
      await expect.element(tabs.nth(0)).toBeInTheDocument();
      await expect.element(tabs.nth(1)).toBeInTheDocument();
    });

    it('should have files tab selected by default', async () => {
      const state = createState();
      render(RecentItemsWrapper, { state });

      const filesTab = page.getByRole('tab').first();
      await expect.element(filesTab).toHaveAttribute('aria-selected', 'true');
    });

    it('should switch to locations tab on click', async () => {
      const state = createState({ recentLocations: [makeRecentLocation()] });
      render(RecentItemsWrapper, { state });

      const locationsTab = page.getByRole('tab').nth(1);
      await locationsTab.click();
      await expect.element(locationsTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('files tab', () => {
    it('should show empty state when no recent files', async () => {
      const state = createState();
      render(RecentItemsWrapper, { state });

      await expect.element(page.getByText(/no recent/i)).toBeInTheDocument();
    });

    it('should show file name in table', async () => {
      const state = createState({ recentFiles: [makeRecentFile({ key: 'docs/report.pdf' })] });
      render(RecentItemsWrapper, { state });

      await expect.element(page.getByText('report.pdf')).toBeInTheDocument();
    });

    it('should show file size', async () => {
      const state = createState({ recentFiles: [makeRecentFile({ key: 'a.txt', size: 2048 })] });
      render(RecentItemsWrapper, { state });

      await expect.element(page.getByText(/2.*kB/)).toBeInTheDocument();
    });

    it('should show multiple files', async () => {
      const files = [
        makeRecentFile({ key: 'one.txt', bucket: 'b1' }),
        makeRecentFile({ key: 'two.csv', bucket: 'b2' }),
        makeRecentFile({ key: 'three.json', bucket: 'b3' })
      ];
      const state = createState({ recentFiles: files });
      render(RecentItemsWrapper, { state });

      await expect.element(page.getByText('one.txt')).toBeInTheDocument();
      await expect.element(page.getByText('two.csv')).toBeInTheDocument();
      await expect.element(page.getByText('three.json')).toBeInTheDocument();
    });

    it('should have preview button with aria-label', async () => {
      const state = createState({ recentFiles: [makeRecentFile({ key: 'data/file.txt' })] });
      render(RecentItemsWrapper, { state });

      const previewBtn = page.getByRole('button', { name: /preview.*file\.txt/i });
      await expect.element(previewBtn).toBeInTheDocument();
    });

    it('should have open folder link with aria-label', async () => {
      const state = createState({ recentFiles: [makeRecentFile({ key: 'data/file.txt' })] });
      render(RecentItemsWrapper, { state });

      const folderLink = page.getByRole('link', { name: /open folder.*file\.txt/i });
      await expect.element(folderLink).toBeInTheDocument();
    });
  });

  describe('locations tab', () => {
    it('should show empty state when no recent locations', async () => {
      const state = createState();
      render(RecentItemsWrapper, { state });

      await page.getByRole('tab').nth(1).click();
      await expect.element(page.getByText(/no recent/i)).toBeInTheDocument();
    });

    it('should show location name', async () => {
      const state = createState({
        recentLocations: [makeRecentLocation({ bucket: 'data-lake', prefix: 'reports/' })]
      });
      render(RecentItemsWrapper, { state });

      await page.getByRole('tab').nth(1).click();
      await expect
        .element(page.getByRole('link', { name: 'reports', exact: true }))
        .toBeInTheDocument();
    });

    it('should show bucket name for root locations', async () => {
      const state = createState({
        recentLocations: [makeRecentLocation({ bucket: 'my-bucket', prefix: '' })]
      });
      render(RecentItemsWrapper, { state });

      await page.getByRole('tab').nth(1).click();
      const link = page.getByRole('link', { name: 'my-bucket', exact: true });
      await expect.element(link.first()).toBeInTheDocument();
    });

    it('should show navigate link with aria-label', async () => {
      const state = createState({
        recentLocations: [makeRecentLocation({ bucket: 'b', prefix: 'pathdir/' })]
      });
      render(RecentItemsWrapper, { state });

      await page.getByRole('tab').nth(1).click();
      const navLink = page.getByRole('link', { name: /go to.*pathdir/i });
      await expect.element(navLink).toBeInTheDocument();
    });

    it('should show multiple locations', async () => {
      const locs = [
        makeRecentLocation({ bucket: 'b1', prefix: 'alpha/' }),
        makeRecentLocation({ bucket: 'b2', prefix: 'beta/' })
      ];
      const state = createState({ recentLocations: locs });
      render(RecentItemsWrapper, { state });

      await page.getByRole('tab').nth(1).click();
      await expect
        .element(page.getByRole('link', { name: 'alpha', exact: true }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole('link', { name: 'beta', exact: true }))
        .toBeInTheDocument();
    });
  });

  describe('preview modal', () => {
    it('should open preview modal when preview button is clicked', async () => {
      const state = createState({
        recentFiles: [makeRecentFile({ key: 'docs/report.pdf', bucket: 'my-bucket' })]
      });
      render(RecentItemsWrapper, { state });

      const previewBtn = page.getByRole('button', { name: /preview.*report\.pdf/i });
      await previewBtn.click();

      // The PreviewModal should now be open (rendered as a dialog)
      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('tab switching', () => {
    it('should switch back to files tab after viewing locations', async () => {
      const state = createState({
        recentFiles: [makeRecentFile({ key: 'file.txt' })],
        recentLocations: [makeRecentLocation({ prefix: 'data/' })]
      });
      render(RecentItemsWrapper, { state });

      // Switch to locations
      const locationsTab = page.getByRole('tab').nth(1);
      await locationsTab.click();
      await expect.element(locationsTab).toHaveAttribute('aria-selected', 'true');

      // Switch back to files
      const filesTab = page.getByRole('tab').first();
      await filesTab.click();
      await expect.element(filesTab).toHaveAttribute('aria-selected', 'true');
      await expect.element(page.getByText('file.txt')).toBeInTheDocument();
    });
  });
});
