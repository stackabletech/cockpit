import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mockPage = vi.hoisted(() => ({
  url: new URL('http://localhost/'),
  status: 500,
  error: { message: 'An unexpected error occurred' } as App.Error | null
}));

vi.mock('$app/state', () => ({ page: mockPage }));

import ErrorPage from './+error.svelte';

describe('/+error.svelte', () => {
  it('does not link a failing sign-in page to the dashboard, which requires sign-in', async () => {
    mockPage.url = new URL('http://localhost/auth/login');
    render(ErrorPage);

    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Go to dashboard' }))
      .not.toBeInTheDocument();
  });

  it('links to the dashboard elsewhere', async () => {
    mockPage.url = new URL('http://localhost/');
    render(ErrorPage);

    await expect.element(page.getByRole('link', { name: 'Go to dashboard' })).toBeInTheDocument();
  });
});
