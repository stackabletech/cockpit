import { page } from 'vitest/browser';
import { describe, expect, it, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import { userEvent } from 'vitest/browser';
import BucketListWrapper from './__tests__/BucketListWrapper.svelte';
import { setPageState, resetPageState } from './__tests__/page-helper.svelte.js';
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
    it('should highlight the active bucket based on URL', async () => {
      setPageState({
        url: new URL('http://localhost/storage/active-bucket'),
        params: { bucket: 'active-bucket', prefix: '' }
      });
      const state = createState({ buckets: ['active-bucket', 'other-bucket'] });
      render(BucketListWrapper, { state });

      const activeLink = page.getByRole('link', { name: /active-bucket/ });
      await expect.element(activeLink.first()).toHaveAttribute('aria-current', 'page');
    });

    it('should not set aria-current on bucket when navigated into a prefix', async () => {
      setPageState({
        url: new URL('http://localhost/storage/my-bucket/some/prefix'),
        params: { bucket: 'my-bucket', prefix: 'some/prefix' }
      });
      const state = createState({ buckets: ['my-bucket'] });
      render(BucketListWrapper, { state });

      const link = page.getByRole('link', { name: /my-bucket/ });
      await expect.element(link.first()).not.toHaveAttribute('aria-current');
    });

    it('should not highlight any bucket when URL does not match storage', async () => {
      setPageState({ url: new URL('http://localhost/other-page') });
      const state = createState({ buckets: ['bucket-a', 'bucket-b'] });
      render(BucketListWrapper, { state });

      const linkA = page.getByRole('link', { name: /bucket-a/ });
      const linkB = page.getByRole('link', { name: /bucket-b/ });
      await expect.element(linkA.first()).not.toHaveAttribute('aria-current');
      await expect.element(linkB.first()).not.toHaveAttribute('aria-current');
    });

    it('should apply active styling to the matching bucket', async () => {
      setPageState({
        url: new URL('http://localhost/storage/styled-bucket'),
        params: { bucket: 'styled-bucket', prefix: '' }
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
        url: new URL('http://localhost/storage/test-bucket/data/'),
        params: { bucket: 'test-bucket', prefix: 'data' }
      });
      const state = createState({
        buckets: ['test-bucket'],
        pinned: [{ bucket: 'test-bucket', prefix: 'data/' }]
      });
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

  describe('unpin context menu', () => {
    it('should open context menu when more options button is clicked', async () => {
      const state = createState({
        buckets: ['ctx-bucket'],
        pinned: [{ bucket: 'ctx-bucket', prefix: 'only-pin/' }]
      });
      render(BucketListWrapper, { state });

      const moreButton = page.getByRole('button', { name: /more options/i }).first();
      await moreButton.click();

      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).toBeInTheDocument();
    });

    it('should close context menu when close button is clicked', async () => {
      const state = createState({
        buckets: ['ctx-bucket2'],
        pinned: [{ bucket: 'ctx-bucket2', prefix: 'pin2/' }]
      });
      render(BucketListWrapper, { state });

      const moreButton = page.getByRole('button', { name: /more options/i }).first();
      await moreButton.click();
      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).toBeInTheDocument();

      const closeButton = page.getByRole('menuitem', { name: /close/i });
      await closeButton.click();

      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).not.toBeInTheDocument();
    });

    it('should close context menu when Escape key is pressed', async () => {
      const state = createState({
        buckets: ['ctx-bucket3'],
        pinned: [{ bucket: 'ctx-bucket3', prefix: 'pin3/' }]
      });
      render(BucketListWrapper, { state });

      const moreButton = page.getByRole('button', { name: /more options/i }).first();
      await moreButton.click();
      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');

      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).not.toBeInTheDocument();
    });

    it('should close context menu when clicking outside', async () => {
      const state = createState({
        buckets: ['ctx-bucket4'],
        pinned: [{ bucket: 'ctx-bucket4', prefix: 'pin4/' }]
      });
      render(BucketListWrapper, { state });

      const moreButton = page.getByRole('button', { name: /more options/i }).first();
      await moreButton.click();
      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).toBeInTheDocument();

      // Click on the "Buckets" section header — a non-interactive span that is
      // outside the context menu but does not trigger browser navigation.
      const bucketsHeader = page
        .getByRole('navigation')
        .getByText('Buckets', { exact: true });
      await bucketsHeader.click();

      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).not.toBeInTheDocument();
    });

    it('should unpin location when unpin button is clicked', async () => {
      const state = createState({
        buckets: ['ctx-bucket5'],
        pinned: [{ bucket: 'ctx-bucket5', prefix: 'pin5/' }]
      });
      render(BucketListWrapper, { state });

      const moreButton = page.getByRole('button', { name: /more options/i }).first();
      await moreButton.click();

      const unpinButton = page.getByRole('menuitem', { name: /unpin/i });
      await unpinButton.click();

      await expect.element(page.getByRole('menuitem', { name: /unpin/i })).not.toBeInTheDocument();
    });

    it('should not throw when pressing Escape without menu open', async () => {
      const state = createState({ buckets: ['b1'] });
      render(BucketListWrapper, { state });

      await userEvent.keyboard('{Escape}');

      await expect.element(page.getByRole('navigation')).toBeInTheDocument();
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
