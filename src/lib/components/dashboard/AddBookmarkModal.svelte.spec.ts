import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AddBookmarkModal from './AddBookmarkModal.svelte';
import type { Bookmark } from '$lib/dashboard/types';

const { addBookmark, updateBookmark, removeBookmark } = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  updateBookmark: vi.fn(),
  removeBookmark: vi.fn()
}));

vi.mock('$lib/dashboard/bookmarks.svelte.js', () => ({
  addBookmark,
  updateBookmark,
  removeBookmark
}));

const renderModal = (props: Record<string, unknown> = {}) =>
  render(AddBookmarkModal, {
    open: true,
    bookmark: null,
    isAdmin: false,
    ...props
  });

const pinEveryoneCheckbox = () =>
  page.getByRole('checkbox', { name: /pin bookmark for everyone/i });

describe('AddBookmarkModal', () => {
  it('does not show "pin for everyone" for non-admins', async () => {
    renderModal({ isAdmin: false });

    await expect.element(pinEveryoneCheckbox()).not.toBeInTheDocument();
  });

  it('enables "pin for everyone" for admins', async () => {
    renderModal({ isAdmin: true });

    await expect.element(pinEveryoneCheckbox()).toBeEnabled();
  });

  it('does not show the admin-only hint to non-admins', async () => {
    renderModal({ isAdmin: false });

    await expect
      .element(page.getByText('Only administrators can pin bookmarks for everyone'))
      .not.toBeInTheDocument();
  });

  it('shows the general hint to admins', async () => {
    renderModal({ isAdmin: true });

    await expect
      .element(page.getByText('This bookmark is shown to every user'))
      .toBeInTheDocument();
  });

  it('stores pinnedForEveryone: true when an admin pins for everyone', async () => {
    renderModal({ isAdmin: true });

    await page.getByLabelText('Name').fill('Shared Dashboard');
    await page.getByLabelText('URL').fill('https://superset.example.com');
    await pinEveryoneCheckbox().click();
    await page.getByRole('button', { name: 'Add Bookmark' }).click();

    expect(addBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Shared Dashboard', pinnedForEveryone: true })
    );
  });

  it('does not set pinnedForEveryone when a non-admin adds a bookmark', async () => {
    renderModal({ isAdmin: false });

    await page.getByLabelText('Name').fill('Private Dashboard');
    await page.getByLabelText('URL').fill('https://superset.example.com');
    await page.getByRole('button', { name: 'Add Bookmark' }).click();

    expect(addBookmark).toHaveBeenCalledWith(expect.objectContaining({ pinnedForEveryone: false }));
  });

  it('preserves pinnedForEveryone when a non-admin edits an admin-pinned bookmark', async () => {
    const bookmark: Bookmark = {
      id: 'b1',
      productId: 'superset',
      name: 'Shared Dashboard',
      environment: '',
      url: 'https://superset.example.com',
      pinned: false,
      pinnedForEveryone: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    };
    renderModal({ isAdmin: false, bookmark });

    await page.getByLabelText('Name').fill('Renamed Dashboard');
    await page.getByRole('button', { name: 'Save changes' }).click();

    expect(updateBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed Dashboard', pinnedForEveryone: true })
    );
  });
});
