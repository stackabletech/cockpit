import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ConflictResolutionDialog from './ConflictResolutionDialog.svelte';
import type { ConflictEntry } from './conflict-types.js';

const entry: ConflictEntry = {
  id: 'src/a.txt',
  originalName: 'a.txt',
  conflict: true,
  resolution: null,
  customName: 'a (1).txt',
  renameState: 'idle',
  sourceKey: 'src/a.txt',
  kind: 'file',
  allowKeepBoth: true,
  destPrefix: 'dest/'
};

function renderDialog(onCheckRename: (entry: ConflictEntry) => Promise<boolean>) {
  return render(ConflictResolutionDialog, {
    open: true,
    entries: [entry],
    confirmLabel: 'Paste',
    onCheckRename,
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  });
}

async function confirmName(name: string) {
  await userEvent.fill(page.getByLabelText('New file name'), name);
  await page.getByRole('button', { name: 'Confirm name' }).click();
}

describe('ConflictResolutionDialog', () => {
  it('enables the confirm button once the new name is reported free', async () => {
    const onCheckRename = vi.fn(async () => true);
    renderDialog(onCheckRename);

    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await confirmName('b.txt');

    expect(onCheckRename).toHaveBeenCalledWith(expect.objectContaining({ customName: 'b.txt' }));
    await expect.element(page.getByRole('button', { name: 'Paste' })).toBeEnabled();
  });

  it('reports a taken name and keeps the confirm button disabled', async () => {
    renderDialog(async () => false);

    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await confirmName('b.txt');

    await expect
      .element(page.getByText('This name already exists here. Please choose a different name.'))
      .toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Paste' })).toBeDisabled();
  });

  it('ignores a check result that arrives after the user changed the choice', async () => {
    let answer!: (available: boolean) => void;
    renderDialog(() => new Promise<boolean>((resolve) => (answer = resolve)));

    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await confirmName('b.txt');
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await userEvent.fill(page.getByLabelText('New file name'), 'taken.txt');

    answer(true);
    // Let the stale result settle before asserting nothing changed.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect.element(page.getByLabelText('New file name')).toHaveValue('taken.txt');
    await expect.element(page.getByRole('button', { name: 'Paste' })).toBeDisabled();
  });
});
