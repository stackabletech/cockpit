import { page } from 'vitest/browser';
import { describe, expect, it, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import BucketListWrapper from './__tests__/BucketListWrapper.svelte';
import { setPageState, resetPageState } from './__tests__/page-helper.svelte.js';
import { StorageState } from '$lib/storage/state.svelte.js';
import type { StorageLocation } from '$lib/storage/types.js';

function createState(
  opts: {
    buckets?: string[];
    pinned?: StorageLocation[];
  } = {}
): StorageState {
  const buckets = opts.buckets ?? [];
  const state = new StorageState({ connected: true, buckets, connectionId: 'test-conn-id' });
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
  afterEach(() => {
    resetPageState();
  });

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

  describe('active bucket highlighting', () => {
    it('should highlight the active bucket based on storage state', async () => {
      setPageState({
        url: new URL('http://localhost/storage/other-bucket'),
        params: { bucket: 'other-bucket', prefix: '' }
      });
      const state = createState({ buckets: ['active-bucket', 'other-bucket'] });
      state.bucket = 'active-bucket';
      render(BucketListWrapper, { state });

      const activeLink = page.getByRole('link', { name: /active-bucket/ });
      await expect.element(activeLink.first()).toHaveAttribute('aria-current', 'page');
    });

    it('should not set aria-current on bucket when storage is in a prefix', async () => {
      setPageState({
        url: new URL('http://localhost/storage/my-bucket'),
        params: { bucket: 'my-bucket', prefix: '' }
      });
      const state = createState({ buckets: ['my-bucket'] });
      state.prefix = 'some/prefix/';
      render(BucketListWrapper, { state });

      const link = page.getByRole('link', { name: /my-bucket/ });
      await expect.element(link.first()).not.toHaveAttribute('aria-current');
    });

    it('should not highlight any bucket without an active storage location', async () => {
      setPageState({ url: new URL('http://localhost/other-page') });
      const state = createState({ buckets: ['bucket-a', 'bucket-b'] });
      state.bucket = '';
      render(BucketListWrapper, { state });

      const linkA = page.getByRole('link', { name: /bucket-a/ });
      const linkB = page.getByRole('link', { name: /bucket-b/ });
      await expect.element(linkA.first()).not.toHaveAttribute('aria-current');
      await expect.element(linkB.first()).not.toHaveAttribute('aria-current');
    });

    it('should apply active styling to the matching bucket', async () => {
      setPageState({
        url: new URL('http://localhost/storage/other-bucket'),
        params: { bucket: 'other-bucket', prefix: '' }
      });
      const state = createState({ buckets: ['styled-bucket'] });
      render(BucketListWrapper, { state });

      const link = page.getByRole('link', { name: /styled-bucket/ });
      await expect.element(link.first()).toHaveClass('text-primary');
    });
  });

  describe('pinned locations', () => {
    it('should show pinned locations section when pins exist', async () => {
      const state = createState({
        buckets: ['test-bucket'],
        pinned: [{ bucket: 'test-bucket', prefix: 'data/' }]
      });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText(/pinned/i)).toBeInTheDocument();
    });

    it('should not show pinned section when no pins', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText(/bucket/i)).toBeInTheDocument();
    });

    it('should show pinned location label', async () => {
      const state = createState({
        buckets: ['data-lake'],
        pinned: [{ bucket: 'data-lake', prefix: 'reports/2024/' }]
      });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText('2024')).toBeInTheDocument();
    });

    it('should show bucket name as label for root pin', async () => {
      const state = createState({
        buckets: ['my-bucket'],
        pinned: [{ bucket: 'my-bucket', prefix: '' }]
      });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText(/pinned/i)).toBeInTheDocument();
      const links = page.getByRole('link', { name: /my-bucket/ });
      await expect.element(links.first()).toBeInTheDocument();
    });

    it('should highlight active pinned location', async () => {
      setPageState({
        url: new URL('http://localhost/storage/test-bucket/other/'),
        params: { bucket: 'test-bucket', prefix: 'other' }
      });
      const state = createState({
        buckets: ['test-bucket'],
        pinned: [{ bucket: 'test-bucket', prefix: 'data/' }]
      });
      state.prefix = 'data/';
      render(BucketListWrapper, { state });

      const pinnedLinks = page.getByRole('link', { name: /^data$/i });
      await expect.element(pinnedLinks.first()).toHaveAttribute('aria-current', 'page');
    });

    it('should not highlight pinned location when prefix does not match', async () => {
      setPageState({
        url: new URL('http://localhost/storage/test-bucket/other/'),
        params: { bucket: 'test-bucket', prefix: 'other' }
      });
      const state = createState({
        buckets: ['test-bucket'],
        pinned: [{ bucket: 'test-bucket', prefix: 'data/' }]
      });
      state.prefix = 'other/';
      render(BucketListWrapper, { state });

      const pinnedLinks = page.getByRole('link', { name: /^data$/i });
      await expect.element(pinnedLinks.first()).not.toHaveAttribute('aria-current');
    });

    it('should not highlight pinned location when bucket does not match', async () => {
      setPageState({
        url: new URL('http://localhost/storage/other-bucket/'),
        params: { bucket: 'other-bucket', prefix: '' }
      });
      const state = createState({
        buckets: ['test-bucket', 'other-bucket'],
        pinned: [{ bucket: 'test-bucket', prefix: '' }]
      });
      state.bucket = 'other-bucket';
      render(BucketListWrapper, { state });

      const pinnedLinks = page.getByRole('link', { name: /test-bucket/ });
      await expect.element(pinnedLinks.first()).not.toHaveAttribute('aria-current');
    });

    it('should render multiple pinned locations', async () => {
      const state = createState({
        buckets: ['bucket-a', 'bucket-b'],
        pinned: [
          { bucket: 'bucket-a', prefix: '' },
          { bucket: 'bucket-b', prefix: 'logs/' }
        ]
      });
      render(BucketListWrapper, { state });

      await expect.element(page.getByText(/pinned/i)).toBeInTheDocument();
      await expect.element(page.getByText('logs')).toBeInTheDocument();
    });
  });

  describe('unpin button', () => {
    it('unpins only its own location', async () => {
      const state = createState({
        buckets: ['pin-bucket'],
        pinned: [
          { bucket: 'pin-bucket', prefix: 'keep/' },
          { bucket: 'pin-bucket', prefix: 'drop/' }
        ]
      });
      render(BucketListWrapper, { state });

      await page.getByRole('button', { name: 'Unpin drop' }).click();

      expect(state.bookmarks.pinnedLocations).toEqual([
        expect.objectContaining({ bucket: 'pin-bucket', prefix: 'keep/' })
      ]);
      // The clicked button is gone with its row, so focus moves to the remaining one.
      await expect.element(page.getByRole('button', { name: 'Unpin keep' })).toHaveFocus();
    });
  });

  describe('disconnect button', () => {
    it('should render disconnect button', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      await expect.element(page.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    });

    it('should be a type=button (not submit) that opens a confirmation modal', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      const button = page.getByRole('button', { name: /disconnect/i }).first();
      await expect.element(button).toHaveAttribute('type', 'button');
    });

    it('should open confirmation modal when disconnect button is clicked', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      const button = page.getByRole('button', { name: /disconnect/i }).first();
      await button.click();

      await expect.element(page.getByText(/disconnect from storage/i)).toBeInTheDocument();
    });

    it('should close confirmation modal when cancel button is clicked', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      await page
        .getByRole('button', { name: /disconnect/i })
        .first()
        .click();
      await expect.element(page.getByText(/disconnect from storage/i)).toBeInTheDocument();

      await page.getByRole('button', { name: /^cancel$/i }).click();

      await expect.element(page.getByText(/disconnect from storage/i)).not.toBeInTheDocument();
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
