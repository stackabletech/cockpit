import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Bookmark } from '$lib/dashboard/types';
import DashboardBookmarks from './DashboardBookmarks.svelte';

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

describe('DashboardBookmarks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the section heading, subtitle and Add bookmark button', async () => {
    render(DashboardBookmarks, { bookmarks: [] });

    await expect
      .element(page.getByRole('heading', { level: 3, name: 'Bookmarks' }))
      .toBeInTheDocument();
    await expect.element(page.getByText(/bookmarks are added by hand/i)).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /add bookmark/i })).toBeInTheDocument();
  });

  it('shows an empty state when there are no bookmarks', async () => {
    render(DashboardBookmarks, { bookmarks: [] });

    await expect.element(page.getByText(/no bookmarks yet/i)).toBeInTheDocument();
  });

  it('renders a card per bookmark', async () => {
    render(DashboardBookmarks, { bookmarks: [bookmark] });

    await expect
      .element(page.getByRole('link', { name: 'Shared Dashboard' }))
      .toHaveAttribute('href', 'https://superset.example.com');
    await expect.element(page.getByText('prod')).toBeInTheDocument();
    await expect.element(page.getByText(/no bookmarks yet/i)).not.toBeInTheDocument();
  });

  it('opens the add dialog', async () => {
    render(DashboardBookmarks, { bookmarks: [] });

    await page.getByRole('button', { name: /add bookmark/i }).click();

    await expect.element(page.getByRole('dialog', { name: 'Add bookmark' })).toBeVisible();
  });

  it('opens the edit dialog for a bookmark', async () => {
    render(DashboardBookmarks, { bookmarks: [bookmark] });

    await page.getByRole('button', { name: 'Edit bookmark Shared Dashboard' }).click();

    await expect.element(page.getByRole('dialog', { name: 'Edit bookmark' })).toBeVisible();
    await expect.element(page.getByLabelText('Name')).toHaveValue('Shared Dashboard');
  });

  it('toggles the pin through the API', async () => {
    updateBookmark.mockResolvedValue(undefined);
    render(DashboardBookmarks, { bookmarks: [bookmark] });

    await page.getByRole('button', { name: 'Pin bookmark Shared Dashboard' }).click();

    expect(updateBookmark).toHaveBeenCalledWith('b1', { pinned: true });
    expect(addToast).not.toHaveBeenCalled();
  });

  it('shows an error toast when toggling the pin fails', async () => {
    updateBookmark.mockRejectedValue(new Error('500'));
    render(DashboardBookmarks, { bookmarks: [bookmark] });

    await page.getByRole('button', { name: 'Pin bookmark Shared Dashboard' }).click();

    await vi.waitFor(() =>
      expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('Shared Dashboard'))
    );
  });
});
