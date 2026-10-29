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
  removeBookmark: vi.fn(),
  BookmarkRequestError: class extends Error {}
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

  it('shows a message instead of the list, without adding, when loading failed', async () => {
    render(DashboardBookmarks, { bookmarks: null });

    await expect
      .element(page.getByRole('heading', { level: 3, name: 'Bookmarks' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('Bookmarks could not be loaded. Please reload the page later.'))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: /add bookmark/i }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/no bookmarks yet/i)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no bookmarks', async () => {
    render(DashboardBookmarks, { bookmarks: [] });

    await expect.element(page.getByText(/no bookmarks yet/i)).toBeInTheDocument();
  });

  it('renders a card per bookmark with the environment once, as a chip', async () => {
    render(DashboardBookmarks, { bookmarks: [bookmark] });

    await expect
      .element(page.getByRole('link', { name: 'Shared Dashboard', exact: true }))
      .toBeVisible();
    expect(page.getByText('prod', { exact: true }).elements()).toHaveLength(1);
    await expect.element(page.getByText('superset.example.com', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/no bookmarks yet/i)).not.toBeInTheDocument();
  });

  it('opens the bookmark image and title in a new tab', async () => {
    const { container } = render(DashboardBookmarks, { bookmarks: [bookmark] });

    // The image link duplicates the title link and is hidden from assistive technology.
    const imageLink = container.querySelector('a[aria-hidden="true"]')!;
    expect(imageLink.getAttribute('tabindex')).toBe('-1');
    for (const link of [
      page.getByRole('link', { name: 'Shared Dashboard' }).element(),
      imageLink
    ]) {
      expect(link.getAttribute('href')).toBe('https://superset.example.com');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('rel')).toContain('external');
    }
    expect(page.getByRole('link').elements()).toHaveLength(1);
  });

  it('names each card button after its bookmark', async () => {
    render(DashboardBookmarks, {
      bookmarks: [
        { ...bookmark, name: 'Dashboards', pinned: true },
        { ...bookmark, id: 'b2', productId: 'airflow', name: 'Pipelines' }
      ]
    });

    for (const label of [
      'Edit bookmark Dashboards',
      'Unpin bookmark Dashboards',
      'Edit bookmark Pipelines',
      'Pin bookmark Pipelines'
    ]) {
      await expect.element(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
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

  it('discards cancelled edits and prefills the saved values again on reopen', async () => {
    render(DashboardBookmarks, { bookmarks: [bookmark] });
    const editButton = page.getByRole('button', { name: 'Edit bookmark Shared Dashboard' });

    await editButton.click();
    await page.getByLabelText('Name').fill('Not Saved');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await editButton.click();

    await expect.element(page.getByLabelText('Name')).toHaveValue('Shared Dashboard');
    await expect.element(page.getByLabelText('URL')).toHaveValue('https://superset.example.com');
    expect(updateBookmark).not.toHaveBeenCalled();
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
