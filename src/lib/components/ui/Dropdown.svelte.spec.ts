import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DropdownWrapper from './__tests__/DropdownWrapper.svelte';

const anchorSupport = vi.hoisted(() => ({ value: true }));
vi.mock('./popover-position.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./popover-position.js')>()),
  supportsAnchorPositioning: () => anchorSupport.value
}));

const trigger = () => page.getByRole('button', { name: 'Trigger' });
const panel = () => page.getByRole('dialog', { name: 'Panel' });

describe('Dropdown', () => {
  it('stays closed and leaves its content out until the trigger is clicked', async () => {
    render(DropdownWrapper);
    await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
    await expect.element(panel()).not.toBeInTheDocument();
    expect(page.getByLabelText('Field').query()).toBeNull();
  });

  it('opens as a popover below the trigger and reports the rendered panel', async () => {
    const onopen = vi.fn((panel: HTMLElement) => panel.querySelector('input')?.focus());
    render(DropdownWrapper, { onopen });

    await trigger().click();

    await expect.element(panel()).toBeVisible();
    await expect.element(trigger()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText('Open: true')).toBeInTheDocument();
    expect(panel().element().matches(':popover-open')).toBe(true);
    await expect.element(page.getByLabelText('Field')).toHaveFocus();
    // Anchored to the trigger, not centred in the viewport.
    const triggerRect = trigger().element().getBoundingClientRect();
    const panelRect = panel().element().getBoundingClientRect();
    expect(panelRect.top).toBeGreaterThanOrEqual(triggerRect.bottom);
    expect(panelRect.top - triggerRect.bottom).toBeLessThan(16);
  });

  it('closes on Escape and gives the focus back to the trigger', async () => {
    render(DropdownWrapper, { onopen: (p) => p.querySelector('input')?.focus() });
    await trigger().click();
    await expect.element(page.getByLabelText('Field')).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    await expect.element(panel()).not.toBeInTheDocument();
    await expect.element(page.getByText('Open: false')).toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  it('keeps its content while the panel fades out after closing', async () => {
    render(DropdownWrapper);
    await trigger().click();
    await expect.element(panel()).toBeVisible();
    const popover = panel().element() as HTMLElement;
    const closed = new Promise((resolve) => popover.addEventListener('toggle', resolve));

    await userEvent.keyboard('{Escape}');
    await closed;

    expect(popover.matches(':popover-open')).toBe(false);
    expect(popover.getAnimations().length).toBeGreaterThan(0);
    expect(popover.querySelector('input')).not.toBeNull();
    await expect.poll(() => popover.querySelector('input')).toBeNull();
  });

  it('closes on an outside click without taking the focus', async () => {
    render(DropdownWrapper);
    await trigger().click();
    await expect.element(panel()).toBeVisible();

    await page.getByRole('button', { name: 'Outside' }).click();

    await expect.element(panel()).not.toBeInTheDocument();
    await expect.element(trigger()).not.toHaveFocus();
  });

  it('closes when the caller sets open to false', async () => {
    render(DropdownWrapper);
    await trigger().click();

    await page.getByRole('button', { name: 'Done' }).click();

    await expect.element(panel()).not.toBeInTheDocument();
    expect(document.querySelector(':popover-open')).toBeNull();
    await expect.element(trigger()).toHaveFocus();
  });

  it('positions itself by script below the trigger without CSS anchor positioning', async () => {
    anchorSupport.value = false;
    try {
      render(DropdownWrapper);
      await trigger().click();
      await expect.element(panel()).toBeVisible();

      const triggerRect = trigger().element().getBoundingClientRect();
      const panelEl = panel().element() as HTMLElement;
      expect(panelEl.style.top).toBe(`${triggerRect.bottom + 8}px`);
    } finally {
      anchorSupport.value = true;
    }
  });
});
