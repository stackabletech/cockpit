import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/paths', () => ({ resolve: () => '/' }));

import ErrorPanel from './ErrorPanel.svelte';

describe('ErrorPanel', () => {
  it.each([
    [404, 'Page not found'],
    [403, 'Access denied'],
    [500, 'Something went wrong'],
    [502, 'Something went wrong']
  ])('shows a readable title for %i', async (status, title) => {
    render(ErrorPanel, { status });

    const heading = page.getByRole('heading');
    await expect.element(heading).toHaveTextContent(`Error ${status}`);
    await expect.element(heading).toHaveTextContent(title);
  });

  it('shows the request ID of an unexpected error', async () => {
    render(ErrorPanel, { status: 500, requestId: 'req-123' });

    await expect.element(page.getByText('req-123')).toBeInTheDocument();
  });

  it('offers a retry for server errors but not for missing pages', async () => {
    const { rerender } = render(ErrorPanel, { status: 500 });
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await rerender({ status: 404 });
    await expect.element(page.getByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'Go to dashboard' })).toBeInTheDocument();
  });
});
