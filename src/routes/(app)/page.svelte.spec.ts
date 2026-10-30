import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Bookmark, BookmarkLink } from '$lib/dashboard/types';
import Page from './+page.svelte';

const globalBookmark: BookmarkLink = {
  id: 'global-0',
  productId: 'custom',
  name: 'Team Wiki',
  environment: '',
  url: 'https://wiki.example.com',
  pinned: false
};

const renderPage = (
  bookmarks: Bookmark[] | null = [],
  { globalBookmarks = [] as BookmarkLink[], bookmarksFailed = false } = {}
) =>
  render(Page, {
    data: {
      user: undefined,
      storageBrowserEnabled: false,
      bookmarks,
      bookmarksFailed,
      globalBookmarks
    }
  } as unknown as Parameters<typeof render<typeof Page>>[1]);

describe('/(app)/+page.svelte', () => {
  it('should render the platform heading', async () => {
    renderPage();
    await expect.element(page.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('should render the bookmarks section', async () => {
    renderPage();
    await expect
      .element(page.getByRole('heading', { level: 3, name: 'Bookmarks' }))
      .toBeInTheDocument();
  });

  it('says so when loading the bookmarks failed', async () => {
    renderPage(null, { bookmarksFailed: true });

    await expect
      .element(page.getByText('Bookmarks could not be loaded. Please reload the page later.'))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: /add bookmark/i }))
      .not.toBeInTheDocument();
  });

  it('shows the global bookmarks when the user’s are unavailable', async () => {
    renderPage(null, { globalBookmarks: [globalBookmark] });

    await expect.element(page.getByRole('link', { name: 'Team Wiki' })).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: /add bookmark/i }))
      .not.toBeInTheDocument();
  });

  it('hides everything bookmark-related without a user or global bookmarks', async () => {
    renderPage(null);

    await expect.element(page.getByRole('heading', { level: 2 })).toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Bookmarks' })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: /add bookmark/i }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/bookmarks are added by hand/i)).not.toBeInTheDocument();
  });
});
