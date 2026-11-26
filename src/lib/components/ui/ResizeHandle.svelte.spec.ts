import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ResizablePanelWrapper from './__tests__/ResizablePanelWrapper.svelte';

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderPanel(id: string) {
  const label = `Resize ${id}`;
  render(ResizablePanelWrapper, { id, label });
  return page.getByRole('separator', { name: label });
}

function renderedWidth(id: string): number {
  const el = document.querySelector<HTMLElement>(`[data-testid="panel-${id}"]`);
  return el?.getBoundingClientRect().width ?? NaN;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResizeHandle with createResizablePanel', () => {
  it('resizes with the keyboard and saves the width under its own key', async () => {
    const handle = renderPanel('a');
    await expect.element(handle).toHaveAttribute('aria-valuenow', '200');
    expect(renderedWidth('a')).toBe(200);

    (handle.element() as HTMLElement).focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}{ArrowLeft}');

    await expect.element(handle).toHaveAttribute('aria-valuenow', '216');
    expect(renderedWidth('a')).toBe(216);
    expect(localStorage.getItem('panel_width:a')).toBe('216');
    expect(document.documentElement.style.getPropertyValue('--panel-width-a')).toBe('216px');
  });

  it('follows the pointer while dragging and saves on release', async () => {
    const handle = renderPanel('a');
    const el = handle.element() as HTMLElement;
    // Pointer capture needs an active pointer, which synthetic events don't have.
    el.setPointerCapture = () => {};
    const fire = (type: string, clientX: number) =>
      el.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));

    fire('pointerdown', 100);
    fire('pointermove', 150);

    await expect.element(handle).toHaveAttribute('aria-valuenow', '250');
    expect(renderedWidth('a')).toBe(250);
    expect(localStorage.getItem('panel_width:a')).toBeNull();

    fire('pointermove', 1000);
    fire('pointerup', 1000);
    await expect.element(handle).toHaveAttribute('aria-valuenow', '300');
    expect(localStorage.getItem('panel_width:a')).toBe('300');
  });

  it('resets the page cursor when unmounted mid-drag', async () => {
    const { unmount } = render(ResizablePanelWrapper, { id: 'a', label: 'Resize a' });
    const el = page.getByRole('separator', { name: 'Resize a' }).element() as HTMLElement;
    el.setPointerCapture = () => {};
    el.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 100, pointerId: 1, bubbles: true })
    );
    await expect.poll(() => document.body.style.cursor).toBe('col-resize');

    unmount();
    await expect.poll(() => document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('does not change other panels', async () => {
    const a = renderPanel('a');
    renderPanel('b');

    (a.element() as HTMLElement).focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');

    await expect.element(a).toHaveAttribute('aria-valuenow', '220');
    expect(renderedWidth('a')).toBe(220);
    expect(renderedWidth('b')).toBe(200);
    expect(localStorage.getItem('panel_width:b')).toBeNull();
  });

  it.each([
    ['a saved width', '250', 250],
    ['a too large saved width, clamped', '900', 300],
    ['a zero saved width, clamped', '0', 150],
    ['an invalid saved width, ignored', 'wide', 200]
  ])('starts from %s', async (_, stored, expected) => {
    localStorage.setItem('panel_width:a', stored);
    const handle = renderPanel('a');
    await expect.element(handle).toHaveAttribute('aria-valuenow', String(expected));
    expect(renderedWidth('a')).toBe(expected);
  });

  it('clamps the CSS variable to the panel limits', async () => {
    // Before hydration the variable comes unclamped from the inline script in app.html.
    const handle = renderPanel('a');
    await expect.element(handle).toBeVisible();
    document.documentElement.style.setProperty('--panel-width-a', '900px');
    await expect.poll(() => renderedWidth('a')).toBe(300);
  });
});
