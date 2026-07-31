import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

const renderPage = () => render(Page);

describe('/(app)/+page.svelte', () => {
  it('should render the platform heading', async () => {
    renderPage();

    const heading = page.getByRole('heading', {
      level: 2,
      name: /Stackable Unified Data Platform overview/i
    });
    await expect.element(heading).toBeInTheDocument();
  });

  it('should render the dashboard subtitle', async () => {
    renderPage();

    await expect.element(page.getByText(/bookmarks are added by hand/i)).toBeInTheDocument();
  });

  it('should render the Add Bookmark button', async () => {
    renderPage();

    await expect.element(page.getByRole('button', { name: /add bookmark/i })).toBeInTheDocument();
  });

  it('should render the bookmarks section heading', async () => {
    renderPage();

    const heading = page.getByRole('heading', { level: 3, name: 'Bookmarks' });
    await expect.element(heading).toBeInTheDocument();
  });

  it('should show an empty state when there are no bookmarks', async () => {
    renderPage();

    await expect.element(page.getByText(/no bookmarks yet/i)).toBeInTheDocument();
  });
});
