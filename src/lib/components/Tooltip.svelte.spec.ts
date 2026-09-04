import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Tooltip from './Tooltip.svelte';

describe('Tooltip', () => {
  it('renders tooltip text', async () => {
    render(Tooltip, { text: 'Helpful info', x: 100, y: 200 });
    const tooltip = page.getByText('Helpful info');
    await expect.element(tooltip).toBeInTheDocument();
  });

  it('has role="tooltip"', async () => {
    render(Tooltip, { text: 'Info', x: 0, y: 0 });
    const tooltip = page.getByRole('tooltip');
    await expect.element(tooltip).toBeInTheDocument();
  });

  it('does not render when text is null', () => {
    render(Tooltip, { text: null, x: 100, y: 200 });
    expect(page.getByRole('tooltip').query()).toBeNull();
  });

  it('does not render when text is empty string', () => {
    render(Tooltip, { text: '', x: 100, y: 200 });
    expect(page.getByRole('tooltip').query()).toBeNull();
  });

  it('positions based on right orientation (default)', async () => {
    render(Tooltip, { text: 'Right', x: 50, y: 100 });
    const tooltip = page.getByRole('tooltip');
    const el = await tooltip.element();
    const style = el.getAttribute('style');
    expect(style).toContain('left: 56px');
    expect(style).toContain('top: 100px');
  });

  it('positions based on left orientation', async () => {
    render(Tooltip, { text: 'Left', x: 50, y: 100, orientation: 'left' });
    const tooltip = page.getByRole('tooltip');
    const el = await tooltip.element();
    const style = el.getAttribute('style');
    expect(style).toContain('left: 44px');
    expect(style).toContain('top: 100px');
  });

  it('positions based on up orientation', async () => {
    render(Tooltip, { text: 'Up', x: 50, y: 100, orientation: 'up' });
    const tooltip = page.getByRole('tooltip');
    const el = await tooltip.element();
    const style = el.getAttribute('style');
    expect(style).toContain('left: 50px');
    expect(style).toContain('top: 94px');
  });

  it('positions based on down orientation', async () => {
    render(Tooltip, { text: 'Down', x: 50, y: 100, orientation: 'down' });
    const tooltip = page.getByRole('tooltip');
    const el = await tooltip.element();
    const style = el.getAttribute('style');
    expect(style).toContain('left: 50px');
    expect(style).toContain('top: 106px');
  });
});
