import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('shows an error instead of saving a malformed URL', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('Private Dashboard');
    await page.getByLabelText('URL').fill('not a URL');
    await page.getByRole('button', { name: 'Add Bookmark' }).click();

    await expect.element(page.getByText('Enter a valid HTTP or HTTPS URL.')).toBeVisible();
    await expect.element(page.getByLabelText('URL')).toHaveAttribute('aria-invalid', 'true');
    expect(addBookmark).not.toHaveBeenCalled();
  });

  it('shows the URL error when leaving the field with a malformed URL', async () => {
    renderModal();

    await page.getByLabelText('URL').fill('superset.corp');
    await page.getByLabelText('Name').click();

    await expect.element(page.getByText('Enter a valid HTTP or HTTPS URL.')).toBeVisible();
  });

  it('prefills the default name of the preselected product', async () => {
    renderModal();

    await expect.element(page.getByLabelText('Name')).toHaveValue('SQL Editor');
  });

  it('refills the default name on product switch after the name was cleared', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('');
    await page.getByRole('button', { name: 'Superset' }).click();

    await expect.element(page.getByLabelText('Name')).toHaveValue('Dashboards');
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
