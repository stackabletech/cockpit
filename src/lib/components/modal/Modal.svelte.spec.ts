import { describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import Modal from '../Modal.svelte';
import type { Snippet } from 'svelte';

function textSnippet(text: string): Snippet {
  return (() => text) as unknown as Snippet;
}

describe('Modal', () => {
  it('closes only the topmost dialog on Escape', async () => {
    render(Modal, { open: true, children: textSnippet('Outer') });
    render(Modal, { open: true, children: textSnippet('Inner') });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await tick();
    const dialogs = [...document.querySelectorAll('dialog')];
    expect(dialogs[0].open).toBe(true);
    expect(dialogs[1].open).toBe(false);
  });

  it('closes on Escape when a focused widget stops propagation', async () => {
    render(Modal, { open: true, children: textSnippet('Content') });
    const dialog = document.querySelector('dialog')!;
    const input = document.createElement('textarea');
    dialog.appendChild(input);
    input.focus();
    input.addEventListener('keydown', (event) => event.stopPropagation());

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await tick();

    expect(dialog.open).toBe(false);
  });

  it('respects the close guard when a focused widget stops propagation', async () => {
    render(Modal, {
      open: true,
      closeguard: () => false,
      children: textSnippet('Content')
    });
    const dialog = document.querySelector('dialog')!;
    const input = document.createElement('textarea');
    dialog.appendChild(input);
    input.focus();
    input.addEventListener('keydown', (event) => event.stopPropagation());
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    });

    input.dispatchEvent(event);
    await tick();

    expect(dialog.open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not open the dialog when open is false', () => {
    render(Modal, { open: false, children: textSnippet('Content') });
    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(false);
  });

  it('opens the dialog when open is true', () => {
    render(Modal, { open: true, children: textSnippet('Content') });
    const dialog = document.querySelector('dialog');
    // showModal() does not set the open attribute in the spec, but
    // the native <dialog> open property reflects the open state.
    expect(dialog?.open).toBe(true);
  });

  it('renders the dialog element', () => {
    render(Modal, { open: true, children: textSnippet('Content') });
    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
  });

  it('applies custom class', () => {
    render(Modal, { open: true, class: 'my-custom-class', children: textSnippet('Content') });
    const dialog = document.querySelector('dialog');
    expect(dialog?.className).toContain('my-custom-class');
  });
});
