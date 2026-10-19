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
    ...props
  });

const pinCheckbox = () => page.getByRole('checkbox', { name: 'Pin bookmark' });

describe('AddBookmarkModal', () => {
  it('stores pinned: true when the pin checkbox is checked', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('Pinned Dashboard');
    await page.getByLabelText('URL').fill('https://superset.example.com');
    await pinCheckbox().click();
    await page.getByRole('button', { name: 'Add Bookmark' }).click();

    expect(addBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pinned Dashboard', pinned: true })
    );
  });

  it('stores pinned: false by default', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('Private Dashboard');
    await page.getByLabelText('URL').fill('https://superset.example.com');
    await page.getByRole('button', { name: 'Add Bookmark' }).click();

    expect(addBookmark).toHaveBeenCalledWith(expect.objectContaining({ pinned: false }));
  });

  it('disables submission for a malformed URL without throwing', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('Private Dashboard');
    await page.getByLabelText('URL').fill('not a URL');

    await expect.element(page.getByRole('button', { name: 'Add Bookmark' })).toBeDisabled();
  });

  it('preserves the pinned state when editing a bookmark', async () => {
    const bookmark: Bookmark = {
      id: 'b1',
      productId: 'superset',
      name: 'Shared Dashboard',
      environment: '',
      url: 'https://superset.example.com',
      pinned: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    };
    renderModal({ bookmark });

    await expect.element(pinCheckbox()).toBeChecked();
    await page.getByLabelText('Name').fill('Renamed Dashboard');
    await page.getByRole('button', { name: 'Save changes' }).click();

    expect(updateBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1', name: 'Renamed Dashboard', pinned: true })
    );
  });
});
