import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Bookmark } from '$lib/dashboard/types';
import Page from './+page.svelte';

const renderPage = (bookmarks: Bookmark[] | null = []) =>
  render(Page, {
    data: { user: undefined, storageBrowserEnabled: false, bookmarks }
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

  it('hides everything bookmark-related when bookmarks are unavailable', async () => {
    renderPage(null);

    await expect.element(page.getByRole('heading', { level: 2 })).toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Bookmarks' })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: /add bookmark/i }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/bookmarks are added by hand/i)).not.toBeInTheDocument();
  });
});
