import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import IconMore from 'virtual:icons/material-symbols/more-horiz';
import IconEdit from 'virtual:icons/material-symbols/edit';
import IconDelete from 'virtual:icons/material-symbols/delete';
import DropdownMenu from './DropdownMenu.svelte';
import type { ContextMenuAction } from './ContextMenu.svelte';

const actions: ContextMenuAction[] = [
  { key: 'edit', icon: IconEdit, label: 'Edit', href: '#edit' },
  { key: 'delete', icon: IconDelete, label: 'Delete', class: 'text-error' },
  { key: 'secret', icon: IconDelete, label: 'Secret', hidden: true },
  { key: 'locked', icon: IconDelete, label: 'Locked', disabled: true }
];

function renderMenu() {
  const onaction = vi.fn();
  // Away from the left edge, so the end-aligned menu has room.
  render(DropdownMenu, {
    label: 'Options',
    icon: IconMore,
    actions,
    onaction,
    triggerClass: 'ml-96'
  });
  return { onaction, trigger: page.getByRole('button', { name: 'Options' }) };
}

describe('DropdownMenu', () => {
  it('opens below its trigger, aligned to its end, and focuses the first item', async () => {
    const { trigger } = renderMenu();
    await expect.element(page.getByRole('menu', { includeHidden: true })).not.toBeVisible();

    await trigger.click();

    await expect.element(page.getByRole('menu', { name: 'Options' })).toBeVisible();
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    const triggerRect = trigger.element().getBoundingClientRect();
    // The popover around the menu; measured once DaisyUI's scale-in animation has finished.
    const popover = document.querySelector<HTMLElement>('[popover]')!;
    await Promise.all(popover.getAnimations().map((a) => a.finished));
    const menuRect = popover.getBoundingClientRect();
    expect(menuRect.top).toBeGreaterThanOrEqual(triggerRect.bottom - 1);
    expect(Math.abs(menuRect.right - triggerRect.right)).toBeLessThan(2);
  });

  it('renders visible actions only and keeps disabled ones inert', async () => {
    const { trigger } = renderMenu();
    await trigger.click();

    const items = page.getByRole('menuitem');
    await expect.element(items.nth(0)).toHaveTextContent('Edit');
    expect(items.elements()).toHaveLength(3);
    await expect.element(page.getByRole('menuitem', { name: 'Locked' })).toBeDisabled();
  });

  it('runs an action, closes and returns focus to the trigger', async () => {
    const { trigger, onaction } = renderMenu();
    await trigger.click();

    await page.getByRole('menuitem', { name: 'Delete' }).click();

    expect(onaction).toHaveBeenCalledExactlyOnceWith('delete');
    await expect.element(page.getByRole('menu', { includeHidden: true })).not.toBeVisible();
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect.element(trigger).toHaveFocus();
  });

  it('opens from the keyboard and closes on Escape', async () => {
    const { trigger } = renderMenu();
    trigger.element().focus();

    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('menu')).toBeVisible();

    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('menu', { includeHidden: true })).not.toBeVisible();
    await expect.element(trigger).toHaveFocus();
  });

  it('moves between enabled items with the arrow keys and closes on Tab', async () => {
    const { trigger } = renderMenu();
    await trigger.click();
    const edit = page.getByRole('menuitem', { name: 'Edit' });
    const del = page.getByRole('menuitem', { name: 'Delete' });

    await userEvent.keyboard('{ArrowDown}');
    await expect.element(del).toHaveFocus();
    // Wraps around and skips the disabled item.
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(edit).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(del).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect.element(edit).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect.element(del).toHaveFocus();

    await userEvent.keyboard('{Tab}');
    await expect.element(page.getByRole('menu', { includeHidden: true })).not.toBeVisible();
  });

  it('flips above its trigger when there is no room below', async () => {
    render(DropdownMenu, {
      label: 'Options',
      icon: IconMore,
      actions,
      onaction: vi.fn(),
      triggerClass: 'fixed bottom-1 left-96'
    });
    const trigger = page.getByRole('button', { name: 'Options' });
    await trigger.click();

    const popover = document.querySelector<HTMLElement>('[popover]')!;
    await Promise.all(popover.getAnimations().map((a) => a.finished));
    expect(popover.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      trigger.element().getBoundingClientRect().top + 1
    );
  });

  it('positions itself by script where the browser lacks anchor positioning', async () => {
    const supports = vi.spyOn(CSS, 'supports').mockReturnValue(false);
    try {
      const { trigger } = renderMenu();
      await trigger.click();

      const popover = document.querySelector<HTMLElement>('[popover]')!;
      await expect.poll(() => popover.style.top).not.toBe('');
      const triggerRect = trigger.element().getBoundingClientRect();
      expect(parseFloat(popover.style.top)).toBeCloseTo(triggerRect.bottom + 8, 0);
    } finally {
      supports.mockRestore();
    }
  });
});
