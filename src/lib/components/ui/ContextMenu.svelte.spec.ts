import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import IconEdit from 'virtual:icons/material-symbols/edit';
import IconDelete from 'virtual:icons/material-symbols/delete';
// The real stylesheet, so a display class that would show the closed popover is caught.
import '../../../app.css';
import ContextMenu from './ContextMenu.svelte';
import type { MenuAction } from './MenuItems.svelte';

const actions: MenuAction[] = [
  { key: 'edit', icon: IconEdit, label: 'Edit', href: '/edit' },
  { key: 'delete', icon: IconDelete, label: 'Delete', class: 'text-error' },
  { key: 'secret', icon: IconDelete, label: 'Secret', hidden: true },
  { key: 'locked', icon: IconDelete, label: 'Locked', disabled: true }
];

function renderMenu(props: Partial<{ open: boolean; x: number; y: number; title: string }> = {}) {
  const onaction = vi.fn();
  const onclose = vi.fn();
  const { rerender } = render(ContextMenu, {
    open: true,
    x: 100,
    y: 80,
    actions,
    onaction,
    onclose,
    ...props
  });
  const menu = () => document.querySelector<HTMLElement>('[popover]')!;
  return { rerender, onaction, onclose, menu };
}

describe('ContextMenu', () => {
  afterEach(() => document.querySelectorAll('[data-outside]').forEach((el) => el.remove()));

  it('stays hidden while closed', async () => {
    renderMenu({ open: false });
    await expect.element(page.getByRole('menu', { includeHidden: true })).not.toBeVisible();
  });

  it('opens as a popover at the given point and takes focus', async () => {
    const { menu } = renderMenu();
    await expect.element(page.getByRole('menu')).toBeVisible();
    expect(menu().matches(':popover-open')).toBe(true);
    expect(menu().style.left).toBe('100px');
    expect(menu().style.top).toBe('80px');
    expect(document.activeElement?.getAttribute('role')).toBe('menu');
  });

  it('stays open when a right-click opens it', async () => {
    const target = document.createElement('div');
    target.textContent = 'Target';
    target.dataset.outside = '';
    document.body.append(target);
    const { onclose, rerender } = renderMenu({ open: false });
    target.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void rerender({ open: true });
    });

    await page.getByText('Target').click({ button: 'right' });

    await expect.element(page.getByRole('menu')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(page.getByRole('menu')).toBeVisible();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('moves to a second right-click instead of closing', async () => {
    const target = document.createElement('div');
    target.textContent = 'Target';
    target.dataset.outside = '';
    target.style.cssText = 'position: fixed; left: 200px; top: 200px; padding: 8px;';
    document.body.append(target);
    const { onclose, rerender, menu } = renderMenu();
    await expect.element(page.getByRole('menu')).toBeVisible();
    target.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void rerender({ x: e.clientX, y: e.clientY });
    });

    await page.getByText('Target').click({ button: 'right' });

    await expect.poll(() => parseInt(menu().style.top)).toBeGreaterThanOrEqual(200);
    await expect.element(page.getByRole('menu')).toBeVisible();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('hides without reporting a close when the parent closes it', async () => {
    const { onclose, rerender, menu } = renderMenu();
    await expect.element(page.getByRole('menu')).toBeVisible();
    await rerender({ open: false });
    expect(menu().matches(':popover-open')).toBe(false);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('flips to the other side of the point near the viewport edges', async () => {
    const x = window.innerWidth - 5;
    const y = window.innerHeight - 5;
    const { menu } = renderMenu({ x, y });
    await expect.element(page.getByRole('menu')).toBeVisible();
    const rect = menu().getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(x + 1);
    expect(rect.bottom).toBeLessThanOrEqual(y + 1);
  });

  it('renders visible actions as buttons or links', async () => {
    renderMenu();
    await expect
      .element(page.getByRole('menuitem', { name: 'Edit' }))
      .toHaveAttribute('href', '/edit');
    await expect.element(page.getByRole('menuitem', { name: 'Locked' })).toBeDisabled();
    await expect.element(page.getByRole('menuitem', { name: 'Secret' })).not.toBeInTheDocument();
  });

  it('runs an action and closes', async () => {
    const { onaction, onclose } = renderMenu();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    expect(onaction).toHaveBeenCalledExactlyOnceWith('delete');
    expect(onclose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const { onclose, menu } = renderMenu();
    await expect.element(page.getByRole('menu')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(onclose).toHaveBeenCalled();
    expect(menu().matches(':popover-open')).toBe(false);
  });

  it('closes on a click outside', async () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    outside.dataset.outside = '';
    document.body.append(outside);
    const { onclose } = renderMenu({ x: 300, y: 300 });
    await expect.element(page.getByRole('menu')).toBeVisible();
    await page.getByRole('button', { name: 'Outside' }).click();
    expect(onclose).toHaveBeenCalled();
  });

  it('closes from the title close button', async () => {
    const { onclose, onaction } = renderMenu({ title: 'Actions' });
    await page.getByRole('button', { name: 'Close' }).click();
    expect(onclose).toHaveBeenCalled();
    expect(onaction).not.toHaveBeenCalled();
  });

  it('starts the arrow keys at the first action, not at the close button', async () => {
    renderMenu({ title: 'Actions' });
    await expect.element(page.getByRole('menu')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(page.getByRole('menuitem').first()).toHaveFocus();
    await expect
      .element(page.getByRole('button', { name: 'Close' }))
      .toHaveAttribute('tabindex', '-1');
  });
});
