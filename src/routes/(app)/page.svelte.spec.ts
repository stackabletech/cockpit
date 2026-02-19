import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('/(app)/+page.svelte', () => {
  it('should render the welcome heading', async () => {
    render(Page);

    const heading = page.getByRole('heading', { level: 2, name: /welcome back/i });
    await expect.element(heading).toBeInTheDocument();
  });

  it('should render the three stat cards', async () => {
    render(Page);

    await expect.element(page.getByText('Services', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('Active Queries')).toBeInTheDocument();
    await expect.element(page.getByText('Health', { exact: true })).toBeInTheDocument();
  });

  it('should render the getting started section', async () => {
    render(Page);

    const heading = page.getByRole('heading', { level: 3, name: /getting started/i });
    await expect.element(heading).toBeInTheDocument();
  });

  it('should render the setup steps', async () => {
    render(Page);

    const steps = page.getByRole('list', { name: /setup steps/i });
    await expect.element(steps).toBeInTheDocument();

    await expect.element(page.getByText('Configure OIDC authentication')).toBeInTheDocument();
    await expect.element(page.getByText('Connect Trino instances')).toBeInTheDocument();
    await expect.element(page.getByText('Browse catalogues and query')).toBeInTheDocument();
  });
});
