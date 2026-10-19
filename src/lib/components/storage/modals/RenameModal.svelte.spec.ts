import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RenameModal from './RenameModal.svelte';

async function renderModal(currentName = 'report.csv') {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(RenameModal, { open: true, currentName, onConfirm, onCancel });
  const message = document.querySelector<HTMLElement>('.modal-box [aria-live="polite"]')!;
  const input = page.getByLabelText('New name');
  // The modal selects the base name a frame after opening; a fill() that
  // overlaps it only replaces that selection.
  const el = input.element() as HTMLInputElement;
  await expect
    .poll(() => document.activeElement === el && el.selectionStart === 0 && el.selectionEnd! > 0)
    .toBe(true);
  return { onConfirm, onCancel, input, message };
}

describe('RenameModal', () => {
  it('explains an invalid name at the input instead of closing', async () => {
    const { onConfirm, onCancel, input, message } = await renderModal();

    await input.fill('a/b.csv');

    await expect.element(message).toHaveTextContent(/single name without "\/"/);
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    await expect.element(input).toHaveAttribute('aria-describedby', message.id);
    await expect.element(page.getByRole('button', { name: 'Rename' })).toBeDisabled();

    await userEvent.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('explains reserved characters, relative segments and empty names', async () => {
    const { input, message } = await renderModal();

    await input.fill('x?y');
    await expect.element(message).toHaveTextContent(/without the characters/);

    await input.fill('..');
    await expect.element(message).toHaveTextContent(/not "\." or "\.\."/);

    await input.fill(' ');
    await expect.element(message).toHaveTextContent('Enter a name.');
  });

  it('does not flag an unchanged existing name that new names may not use', async () => {
    const { input, message } = await renderModal('what?.csv');

    await expect.element(input).toHaveValue('what?.csv');
    await expect.poll(() => message.textContent?.trim()).toBe('');
  });

  it('does not rename an unchanged name with surrounding whitespace', async () => {
    const { onConfirm, onCancel, input, message } = await renderModal(' padded.csv ');

    await expect.element(input).toHaveValue(' padded.csv ');
    await expect.poll(() => message.textContent?.trim()).toBe('');
    await expect.element(page.getByRole('button', { name: 'Rename' })).toBeDisabled();

    await input.click();
    await userEvent.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('submits a valid trimmed name', async () => {
    const { onConfirm, input } = await renderModal();

    await input.fill(' renamed.csv ');
    await page.getByRole('button', { name: 'Rename' }).click();

    expect(onConfirm).toHaveBeenCalledWith('renamed.csv');
  });
});
