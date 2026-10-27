import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Bookmark } from '$lib/dashboard/types';
import Page from './+page.svelte';

const { updateBookmark, addToast } = vi.hoisted(() => ({
  updateBookmark: vi.fn(),
  addToast: vi.fn()
}));

vi.mock('$lib/dashboard/bookmarks-api.js', () => ({
  addBookmark: vi.fn(),
  updateBookmark,
  removeBookmark: vi.fn()
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ addToast }));

const bookmark: Bookmark = {
  id: 'b1',
  productId: 'superset',
  name: 'Shared Dashboard',
  environment: 'prod',
  url: 'https://superset.example.com',
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z'
};

const renderPage = (bookmarks: Bookmark[] | null = []) =>
  render(Page, {
    data: { user: undefined, storageBrowserEnabled: false, bookmarks }
  } as unknown as Parameters<typeof render<typeof Page>>[1]);

describe('/(app)/+page.svelte', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('hides everything bookmark-related when bookmarks are unavailable', async () => {
    renderPage(null);

    await expect.element(page.getByRole('heading', { level: 2 })).toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Bookmarks' })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: /add bookmark/i }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/bookmarks are added by hand/i)).not.toBeInTheDocument();
  });

  it('toggles the pin through the API', async () => {
    updateBookmark.mockResolvedValue(undefined);
    renderPage([bookmark]);

    await page.getByRole('button', { name: 'Pin bookmark Shared Dashboard' }).click();

    expect(updateBookmark).toHaveBeenCalledWith('b1', { pinned: true });
    expect(addToast).not.toHaveBeenCalled();
  });

  it('shows an error toast when toggling the pin fails', async () => {
    updateBookmark.mockRejectedValue(new Error('500'));
    renderPage([bookmark]);

    await page.getByRole('button', { name: 'Pin bookmark Shared Dashboard' }).click();

    await vi.waitFor(() =>
      expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('Shared Dashboard'))
    );
  });
});
