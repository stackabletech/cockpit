import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TooltipTriggerWrapper from './__tests__/TooltipTriggerWrapper.svelte';
import TooltipTriggerDialogWrapper from './__tests__/TooltipTriggerDialogWrapper.svelte';

describe('TooltipTrigger', () => {
  it('renders the trigger content without a tooltip', async () => {
    render(TooltipTriggerWrapper, { text: 'Delete' });
    await expect.element(page.getByRole('button', { name: 'Trigger' })).toBeInTheDocument();
    expect(page.getByRole('tooltip').query()).toBeNull();
  });

  it('shows the tooltip when the trigger is hovered', async () => {
    render(TooltipTriggerWrapper, { text: 'Delete' });
    await page.getByRole('button', { name: 'Trigger' }).hover();
    const tooltip = page.getByRole('tooltip');
    await expect.element(tooltip).toBeInTheDocument();
    await expect.element(tooltip).toHaveTextContent('Delete');
  });

  it('hides the tooltip when the pointer leaves the trigger', async () => {
    render(TooltipTriggerWrapper, { text: 'Delete' });
    await page.getByRole('button', { name: 'Trigger' }).hover();
    await expect.element(page.getByRole('tooltip')).toBeInTheDocument();
    await userEvent.unhover(await page.getByRole('button', { name: 'Trigger' }).element());
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the tooltip when the trigger receives focus', async () => {
    render(TooltipTriggerWrapper, { text: 'Delete' });
    const button = page.getByRole('button', { name: 'Trigger' });
    (await button.element()).focus();
    await expect.element(page.getByRole('tooltip')).toBeInTheDocument();
  });

  it('hides the tooltip when the trigger loses focus', async () => {
    render(TooltipTriggerWrapper, { text: 'Delete' });
    const button = page.getByRole('button', { name: 'Trigger' });
    (await button.element()).focus();
    await expect.element(page.getByRole('tooltip')).toBeInTheDocument();
    (await button.element()).blur();
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not show a tooltip when text is null', async () => {
    render(TooltipTriggerWrapper, { text: null });
    await page.getByRole('button', { name: 'Trigger' }).hover();
    expect(page.getByRole('tooltip').query()).toBeNull();
  });

  it('renders the tooltip in a portal attached to <body>, not inline in the trigger', async () => {
    render(TooltipTriggerWrapper, { text: 'Delete' });
    await page.getByRole('button', { name: 'Trigger' }).hover();
    const tooltipEl = (await page.getByRole('tooltip').element()) as HTMLElement;
    const triggerEl = (await page
      .getByRole('button', { name: 'Trigger' })
      .element()) as HTMLElement;
    // The popup is portaled: it must not be a descendant of the trigger wrapper.
    expect(triggerEl.contains(tooltipEl)).toBe(false);
    // It is mounted into a host div that is a direct child of <body>.
    expect(tooltipEl.parentElement?.parentElement).toBe(document.body);
  });

  it('portals the tooltip into a <dialog> ancestor so it escapes the modal', async () => {
    render(TooltipTriggerDialogWrapper, { text: 'Delete' });
    const dialogEl = document.querySelector('dialog');
    expect(dialogEl).not.toBeNull();
    await page.getByRole('button', { name: 'Trigger' }).hover();
    const tooltipEl = (await page.getByRole('tooltip').element()) as HTMLElement;
    // The popup must be inside the dialog (top layer), not attached to <body>.
    expect(dialogEl!.contains(tooltipEl)).toBe(true);
  });
});
