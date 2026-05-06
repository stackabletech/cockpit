import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThemeToggle from './ThemeToggle.svelte';

describe('ThemeToggle', () => {
  it('should render a toggle button', async () => {
    render(ThemeToggle);

    const control = page.getByRole('button');
    await expect.element(control).toBeInTheDocument();
  });

  it('should toggle the aria-label on click', async () => {
    render(ThemeToggle);
    const control = page.getByRole('button');

    // Starts in light mode — label offers to switch to dark
    await expect.element(control).toHaveAttribute('aria-label', 'Switch to dark mode');

    await control.click();

    // Now in dark mode — label offers to switch to light
    await expect.element(control).toHaveAttribute('aria-label', 'Switch to light mode');
  });

  it('should toggle the data-theme attribute on the document', async () => {
    render(ThemeToggle);
    const control = page.getByRole('button');
    const themeBefore = document.documentElement.getAttribute('data-theme');

    await control.click();
    const themeAfter = document.documentElement.getAttribute('data-theme');
    expect(themeAfter).not.toBe(themeBefore);

    await control.click();
    const themeRestored = document.documentElement.getAttribute('data-theme');
    expect(themeRestored).toBe(themeBefore);
  });
});
