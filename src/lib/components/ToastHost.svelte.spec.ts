import { page } from 'vitest/browser';
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ToastHost from './ToastHost.svelte';
import { toasts, addToast } from '$lib/stores/toast.svelte.js';

beforeEach(() => {
  toasts.length = 0;
});

describe('ToastHost', () => {
  it('renders nothing when there are no toasts', () => {
    render(ToastHost);
    expect(page.getByRole('alert').query()).toBeNull();
  });

  it('renders a toast added before render', () => {
    addToast('info', 'Pre-existing toast');
    render(ToastHost);
    expect(page.getByText('Pre-existing toast').query()).not.toBeNull();
  });

  it('labels the dismiss button', () => {
    addToast('info', 'Hello');
    render(ToastHost);
    const dismissBtn = page.getByRole('button', { name: 'Dismiss' });
    expect(dismissBtn.query()).not.toBeNull();
  });

  it('renders multiple pre-existing toasts', () => {
    addToast('info', 'First');
    addToast('success', 'Second');
    render(ToastHost);
    const alerts = document.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(2);
  });

  it('renders action buttons when toast has actions', () => {
    addToast('warning', 'With action', 5000, [{ label: 'Undo', onClick: () => {} }]);
    render(ToastHost);
    const undoBtn = page.getByText('Undo');
    expect(undoBtn.query()).not.toBeNull();
  });

  it('has aria-live="polite" for screen reader announcements', () => {
    render(ToastHost);
    const container = document.querySelector('[aria-live="polite"]');
    expect(container).not.toBeNull();
  });
});
