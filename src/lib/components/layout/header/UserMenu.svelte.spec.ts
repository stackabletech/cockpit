import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { User } from '$lib/types/auth.js';
import UserMenu from './UserMenu.svelte';

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null } as User;

describe('UserMenu', () => {
  it('opens above the page with the focus on the sign out link', async () => {
    render(UserMenu, { user });

    await page.getByRole('button', { name: 'User menu' }).click();

    const panel = page.getByRole('dialog', { name: 'User menu' });
    await expect.element(panel).toBeVisible();
    // A popover in the top layer, so no z-index on the page can cover it.
    expect(panel.element().matches(':popover-open')).toBe(true);
    await expect.element(panel.getByText('ada@example.com')).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Sign out' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await expect.element(panel).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'User menu' })).toHaveFocus();
  });
});
