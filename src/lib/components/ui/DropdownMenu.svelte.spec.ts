import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DropdownMenuWrapper from './__tests__/DropdownMenuWrapper.svelte';

const trigger = () => page.getByRole('button', { name: 'Trigger' });
const menu = () => page.getByRole('menu', { name: 'Options' });
const item = (name: string) => page.getByRole('menuitem', { name });

function renderMenu() {
  const onaction = vi.fn();
  render(DropdownMenuWrapper, { onaction });
  return { onaction };
}

describe('DropdownMenu', () => {
  it('opens from the keyboard with the focus on the first item', async () => {
    renderMenu();
    await expect.element(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    trigger().element().focus();

    await userEvent.keyboard('{Enter}');

    await expect.element(menu()).toBeVisible();
    await expect.element(item('Edit')).toHaveFocus();
    expect(item('Secret').query()).toBeNull();
  });

  it('moves the focus with the arrow keys, Home and End, skipping disabled items', async () => {
    renderMenu();
    await trigger().click();
    await expect.element(item('Edit')).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    await expect.element(item('Delete')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(item('Edit')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(item('Delete')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect.element(item('Edit')).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect.element(item('Delete')).toHaveFocus();
  });

  it('runs the chosen action, closes and returns the focus to the trigger', async () => {
    const { onaction } = renderMenu();
    await trigger().click();

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onaction).toHaveBeenCalledExactlyOnceWith('delete');
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  it('closes when Tab moves the focus on, and leaves the focus there', async () => {
    renderMenu();
    await trigger().click();
    await expect.element(item('Edit')).toHaveFocus();

    await userEvent.keyboard('{Tab}');

    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'After' })).toHaveFocus();
  });
});
