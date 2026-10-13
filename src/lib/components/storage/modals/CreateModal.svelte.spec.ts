import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CreateModal from './CreateModal.svelte';

function renderModal(props: Partial<Parameters<typeof render<typeof CreateModal>>[1]> = {}) {
  const onConfirm = vi.fn();
  render(CreateModal, { open: true, type: 'file', onConfirm, onCancel: vi.fn(), ...props });
  const message = document.querySelector<HTMLElement>('.modal-box [aria-live="polite"]')!;
  return { onConfirm, input: page.getByLabelText('Name'), message };
}

describe('CreateModal', () => {
  it('explains an invalid name at the input and does not submit it', async () => {
    const { onConfirm, input, message } = renderModal();

    await input.fill('x?y.txt');

    await expect.element(message).toHaveTextContent(/without the characters/);
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    expect(message.id).not.toBe('');
    await expect.element(input).toHaveAttribute('aria-describedby', message.id);
    await expect.element(page.getByRole('button', { name: 'Create' })).toBeDisabled();

    await userEvent.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('explains relative path segments and empty names', async () => {
    const { input, message } = renderModal({ type: 'folder' });

    await input.fill('a/../b');
    await expect.element(message).toHaveTextContent(/"\.\." as a path part/);

    await input.fill('   ');
    await expect.element(message).toHaveTextContent('Enter a name.');
  });

  it('explains a name that makes the key too long', async () => {
    const { input, message } = renderModal({ prefix: 'a'.repeat(1000) + '/' });

    await input.fill('b'.repeat(30));

    await expect.element(message).toHaveTextContent(/too long/);
  });

  it('accepts a valid name inside a folder with characters S3 allows', async () => {
    const { onConfirm, input, message } = renderModal({ prefix: 'reports?2024/' });

    await input.fill('  summary.txt ');

    await expect.poll(() => message.textContent?.trim()).toBe('');
    await expect.element(input).not.toHaveAttribute('aria-invalid');
    await expect.element(input).not.toHaveAttribute('aria-describedby');
    await page.getByRole('button', { name: 'Create' }).click();
    expect(onConfirm).toHaveBeenCalledWith('summary.txt');
  });
});
