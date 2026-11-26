import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LanguageSwitcher from './LanguageSwitcher.svelte';

describe('LanguageSwitcher', () => {
  it('opens with the focus on the current language, which is checked', async () => {
    render(LanguageSwitcher);

    await page.getByRole('button', { name: 'Language' }).click();

    const english = page.getByRole('menuitemradio', { name: 'English' });
    await expect.element(english).toHaveFocus();
    await expect.element(english).toHaveAttribute('aria-checked', 'true');
    await expect
      .element(page.getByRole('menuitemradio', { name: 'Deutsch' }))
      .toHaveAttribute('aria-checked', 'false');

    await userEvent.keyboard('{ArrowDown}');
    await expect.element(page.getByRole('menuitemradio', { name: 'Deutsch' })).toHaveFocus();
  });
});
