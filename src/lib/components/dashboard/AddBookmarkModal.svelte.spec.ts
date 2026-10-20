import { page, userEvent } from 'vitest/browser';
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

const savedBookmark: Bookmark = {
  id: 'b1',
  productId: 'superset',
  name: 'Shared Dashboard',
  environment: '',
  url: 'https://superset.example.com',
  pinned: true,
  createdAt: '2026-01-01T00:00:00.000Z'
};

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
    await page.getByRole('button', { name: 'Add bookmark' }).click();

    expect(addBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pinned Dashboard', pinned: true })
    );
  });

  it('stores pinned: false by default', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('Private Dashboard');
    await page.getByLabelText('URL').fill('https://superset.example.com');
    await page.getByRole('button', { name: 'Add bookmark' }).click();

    expect(addBookmark).toHaveBeenCalledWith(expect.objectContaining({ pinned: false }));
  });

  it('saves when Enter is pressed in a field', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('Keyboard Dashboard');
    await page.getByLabelText('URL').fill('https://superset.example.com');
    await userEvent.keyboard('{Enter}');

    expect(addBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Keyboard Dashboard', url: 'https://superset.example.com' })
    );
  });

  it('shows the URL error instead of saving when Enter is pressed with a malformed URL', async () => {
    renderModal();

    await page.getByLabelText('URL').fill('not a URL');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText('Enter a valid HTTP or HTTPS URL.')).toBeVisible();
    expect(addBookmark).not.toHaveBeenCalled();
  });

  it('shows an error instead of saving a malformed URL', async () => {
    renderModal();

    await page.getByLabelText('Name').fill('Private Dashboard');
    await page.getByLabelText('URL').fill('not a URL');
    await page.getByRole('button', { name: 'Add bookmark' }).click();

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

  it('names the add dialog after its heading', async () => {
    renderModal();

    await expect.element(page.getByRole('dialog', { name: 'Add bookmark' })).toBeVisible();
  });

  it('names the edit and delete-confirmation dialogs after their headings', async () => {
    renderModal({ bookmark: savedBookmark });

    await expect.element(page.getByRole('dialog', { name: 'Edit bookmark' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect.element(page.getByRole('dialog', { name: 'Delete bookmark?' })).toBeVisible();
  });

  it('keeps unsaved edits when the delete confirmation is cancelled', async () => {
    renderModal({ bookmark: savedBookmark });
    const editDialog = page.getByRole('dialog', { name: 'Edit bookmark' });

    await editDialog.getByLabelText('Name').fill('Renamed but not saved');
    await editDialog.getByRole('button', { name: 'Delete' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Delete bookmark?' });
    await confirmDialog.getByRole('button', { name: 'Cancel' }).click();

    await expect.element(confirmDialog).not.toBeInTheDocument();
    await expect.element(editDialog.getByLabelText('Name')).toHaveValue('Renamed but not saved');
    expect(removeBookmark).not.toHaveBeenCalled();
  });

  it('removes the bookmark and closes both dialogs when deletion is confirmed', async () => {
    renderModal({ bookmark: savedBookmark });

    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete bookmark?' })
      .getByRole('button', { name: 'Delete' })
      .click();

    expect(removeBookmark).toHaveBeenCalledWith('b1');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves the pinned state when editing a bookmark', async () => {
    renderModal({ bookmark: savedBookmark });

    await expect.element(pinCheckbox()).toBeChecked();
    await page.getByLabelText('Name').fill('Renamed Dashboard');
    await page.getByRole('button', { name: 'Save changes' }).click();

    expect(updateBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1', name: 'Renamed Dashboard', pinned: true })
    );
  });
});
