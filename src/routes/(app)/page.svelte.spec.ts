import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

const renderPage = () =>
  render(Page, { params: {}, data: { user: null, serviceCount: 0, healthy: true }, form: null });

describe('/(app)/+page.svelte', () => {
  it('should render the welcome heading', async () => {
    renderPage();

    const heading = page.getByRole('heading', { level: 2, name: /welcome back/i });
    await expect.element(heading).toBeInTheDocument();
  });

  it('should render the three stat cards', async () => {
    renderPage();

    await expect.element(page.getByText('Services', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('Active Queries')).toBeInTheDocument();
    await expect.element(page.getByText('Health', { exact: true })).toBeInTheDocument();
  });

  it('should render the getting started section', async () => {
    renderPage();

    const heading = page.getByRole('heading', { level: 3, name: /getting started/i });
    await expect.element(heading).toBeInTheDocument();
  });

  it('should render the setup steps', async () => {
    renderPage();

    const steps = page.getByRole('list', { name: /setup steps/i });
    await expect.element(steps).toBeInTheDocument();

    await expect.element(page.getByText('Configure OIDC authentication')).toBeInTheDocument();
    await expect.element(page.getByText('Connect Trino instances')).toBeInTheDocument();
    await expect.element(page.getByText('Browse catalogues and query')).toBeInTheDocument();
  });
});
