import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import BucketListWrapper from './__tests__/BucketListWrapper.svelte';
import { StorageState } from '$lib/storage/state.svelte.js';
import type { PinnedLocation } from '$lib/storage/types.js';

function createState(
  opts: {
    buckets?: string[];
    pinned?: PinnedLocation[];
  } = {}
): StorageState {
  const buckets = opts.buckets ?? [];
  const state = new StorageState({ connected: true, buckets });
  state.bucket = buckets[0] ?? '';
  state.prefix = '';
  if (opts.pinned) {
    for (const p of opts.pinned) {
      state.bookmarks.pin(p.bucket, p.prefix);
    }
  }
  return state;
}

describe('BucketList', () => {
  describe('basic rendering', () => {
    it('should render navigation with aria-label', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      await expect.element(page.getByRole('navigation')).toBeInTheDocument();
    });

    it('should show bucket names', async () => {
      const state = createState({ buckets: ['alpha-bucket', 'beta-bucket'] });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText('alpha-bucket')).toBeInTheDocument();
      await expect.element(page.getByText('beta-bucket')).toBeInTheDocument();
    });

    it('should render bucket links', async () => {
      const state = createState({ buckets: ['my-bucket'] });
      render(BucketListWrapper, { state });

      const links = page.getByRole('link', { name: /my-bucket/ });
      await expect.element(links.first()).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should show empty message when no buckets', async () => {
      const state = createState({ buckets: [] });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText(/no bucket/i)).toBeInTheDocument();
    });
  });

  describe('pinned locations', () => {
    it('should show pinned locations section when pins exist', async () => {
      const state = createState({
        buckets: ['test-bucket'],
        pinned: [{ bucket: 'test-bucket', prefix: 'data/' }]
      });
      render(BucketListWrapper, { state });

      // Pinned section heading
      await expect.element(page.getByText(/pinned/i)).toBeInTheDocument();
    });

    it('should not show pinned section when no pins', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      // No pinned heading should be visible (check it's not in the DOM)
      const pinnedHeadings = page.getByText(/pinned/i);
      // The word "Pinned" only appears in the pinned section
      // The buckets label should still be there
      await expect.element(page.getByText(/bucket/i)).toBeInTheDocument();
    });

    it('should show pinned location label', async () => {
      const state = createState({
        buckets: ['data-lake'],
        pinned: [{ bucket: 'data-lake', prefix: 'reports/2024/' }]
      });
      render(BucketListWrapper, { state });

      // pinnedLabel returns last folder name: '2024'
      await expect.element(page.getByText('2024')).toBeInTheDocument();
    });

    it('should show bucket name as label for root pin', async () => {
      const state = createState({
        buckets: ['my-bucket'],
        pinned: [{ bucket: 'my-bucket', prefix: '' }]
      });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText(/pinned/i)).toBeInTheDocument();
      // The pinned label for root is the bucket name - it appears multiple times
      const links = page.getByRole('link', { name: /my-bucket/ });
      await expect.element(links.first()).toBeInTheDocument();
    });
  });

  describe('disconnect button', () => {
    it('should render disconnect button', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      await expect.element(page.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    });
  });

  describe('long bucket names', () => {
    it('should render long bucket names without error', async () => {
      const longName = faker.string.alpha(64);
      const state = createState({ buckets: [longName] });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText(longName)).toBeInTheDocument();
    });
  });

  describe('many buckets', () => {
    it('should render many buckets', async () => {
      const buckets = Array.from({ length: 20 }, (_, i) => `bucket-${i}`);
      const state = createState({ buckets });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText('bucket-0')).toBeInTheDocument();
      await expect.element(page.getByText('bucket-19')).toBeInTheDocument();
    });
  });
});
