import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Modal from './Modal.svelte';
import type { Snippet } from 'svelte';

function textSnippet(text: string): Snippet {
  return (() => text) as unknown as Snippet;
}

describe('Modal', () => {
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
