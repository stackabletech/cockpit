import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RunButton from './RunButton.svelte';

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderRunButton(props: Record<string, unknown> = {}) {
  const onRun = vi.fn();
  render(RunButton, { hasSelection: false, isActive: false, disabled: false, onRun, ...props });
  return { onRun };
}

const toggle = () => page.getByRole('button', { name: 'Select run mode' });
const menu = () => page.getByRole('menu', { name: 'Select run mode' });
const item = (name: string) => page.getByRole('menuitemradio', { name, exact: true });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunButton', () => {
  it('runs with the main button', async () => {
    const { onRun } = renderRunButton();

    await page.getByRole('button', { name: 'Run', exact: true }).click();

    expect(onRun).toHaveBeenCalled();
  });

  it('opens the menu as wide as the whole button group', async () => {
    renderRunButton();

    await toggle().click();

    await expect.element(menu()).toBeVisible();
    const group = page.getByRole('button', { name: 'Run', exact: true }).element().parentElement!;
    const panel = menu().element().closest('[popover]')!;
    // The menu follows the group's width through a resize observer, so it can lag a frame behind
    // a change of the group's size, e.g. when a font loads.
    const misalignment = () => {
      const groupBox = group.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      return Math.max(
        Math.abs(panelBox.left - groupBox.left),
        Math.abs(panelBox.right - groupBox.right)
      );
    };
    await expect.poll(misalignment).toBeLessThan(0.5);
  });

  it('keeps the toggle the same size while the menu is open', async () => {
    renderRunButton();
    const width = () => toggle().element().getBoundingClientRect().width;
    const closedWidth = width();

    await toggle().click();
    await expect.element(menu()).toBeVisible();

    expect(width()).toBe(closedWidth);
  });

  it('disables running while the editor is not ready', async () => {
    renderRunButton({ disabled: true });

    await expect.element(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  });

  it('does not open the menu when the Run button gets focus', async () => {
    renderRunButton();

    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the menu from the toggle and marks the selected mode', async () => {
    renderRunButton();

    await toggle().click();

    await expect.element(toggle()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(item('Run Ctrl+↵')).toHaveAttribute('aria-checked', 'true');
    await expect.element(item('Run all Ctrl+Shift+↵')).toHaveAttribute('aria-checked', 'false');
    await expect.element(item('Run Ctrl+↵')).toHaveFocus();
  });

  it('supports the keyboard: ArrowDown opens, arrows move, Escape returns focus', async () => {
    renderRunButton();

    await toggle().click();
    await userEvent.keyboard('{Escape}');
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(toggle()).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    await expect.element(item('Run Ctrl+↵')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(item('Run all Ctrl+Shift+↵')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(item('Run Ctrl+↵')).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect.element(item('Run all Ctrl+Shift+↵')).toHaveFocus();
  });

  it('opens the menu with Space and closes it again with a second click', async () => {
    renderRunButton();

    (toggle().element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await expect.element(item('Run Ctrl+↵')).toHaveFocus();

    await toggle().click();
    await expect.element(menu()).not.toBeInTheDocument();
  });

  it('selects a mode with Enter, closes and relabels the Run button', async () => {
    renderRunButton();

    await toggle().click();
    await userEvent.keyboard('{ArrowDown}{Enter}');

    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(toggle()).toHaveFocus();
    await expect
      .element(page.getByRole('button', { name: 'Run all', exact: true }))
      .toBeInTheDocument();
  });

  it('labels the second mode "Run selected" when text is selected', async () => {
    renderRunButton({ hasSelection: true, runMode: 'all' });

    await expect
      .element(page.getByRole('button', { name: 'Run selected', exact: true }))
      .toBeInTheDocument();
  });

  it('opens the menu with ArrowUp on the last mode', async () => {
    renderRunButton();

    (toggle().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowUp}');

    await expect.element(item('Run all Ctrl+Shift+↵')).toHaveFocus();
  });

  it('cannot change the mode while a query runs', async () => {
    renderRunButton({ isActive: true });

    await expect.element(toggle()).toBeDisabled();
  });
});
