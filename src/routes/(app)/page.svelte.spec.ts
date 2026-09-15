import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

const renderPage = () => render(Page);

describe('/(app)/+page.svelte', () => {
  it('should render the platform heading', async () => {
    renderPage();
    await expect.element(page.getByRole('heading', { level: 2 })).toBeInTheDocument();
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
    await expect
      .element(page.getByRole('heading', { level: 3, name: 'Bookmarks' }))
      .toBeInTheDocument();
  });

  it('should show an empty state when there are no bookmarks', async () => {
    renderPage();
    await expect.element(page.getByText(/no bookmarks yet/i)).toBeInTheDocument();
  });

  it('should hide pin-for-everyone in the modal for non-admins', async () => {
    render(Page, { data: { user: null, storageBrowserEnabled: true, isAdmin: false } });
    await page.getByRole('button', { name: 'Add Bookmark' }).click();
    await expect
      .element(page.getByRole('checkbox', { name: /pin bookmark for everyone/i }))
      .not.toBeInTheDocument();
  });

  it('should enable pin-for-everyone in the modal for admins', async () => {
    render(Page, { data: { user: null, storageBrowserEnabled: true, isAdmin: true } });
    await page.getByRole('button', { name: 'Add Bookmark' }).click();
    await expect
      .element(page.getByRole('checkbox', { name: /pin bookmark for everyone/i }))
      .toBeEnabled();
  });
});
