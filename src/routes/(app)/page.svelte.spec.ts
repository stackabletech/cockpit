import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

const renderPage = () =>
  render(Page, {
    params: {},
    data: {
      user: null,
      storageBrowserEnabled: true,
      isAdmin: false,
      serviceCount: 0,
      healthy: true
    },
    form: null
  });

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

  it('should display the service count from props', async () => {
    render(Page, {
      params: {},
      data: {
        user: null,
        storageBrowserEnabled: true,
        isAdmin: false,
        serviceCount: 5,
        healthy: true
      },
      form: null
    });

    await expect.element(page.getByText('5')).toBeInTheDocument();
  });

  it('should display the health OK status', async () => {
    renderPage();

    await expect.element(page.getByText('OK', { exact: true })).toBeInTheDocument();
  });

  it('should render the dashboard subtitle', async () => {
    renderPage();

    await expect
      .element(page.getByText(/stackable unified data platform overview/i))
      .toBeInTheDocument();
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
    await expect.element(page.getByText('Browse catalogs and query')).toBeInTheDocument();
  });

  it('should disable pin-for-everyone in the modal for non-admins', async () => {
    render(Page, {
      params: {},
      data: {
        user: null,
        storageBrowserEnabled: true,
        isAdmin: false,
        serviceCount: 0,
        healthy: true
      },
      form: null
    });

    await page.getByRole('button', { name: 'Add Bookmark' }).click();

    await expect
      .element(page.getByRole('checkbox', { name: /pin bookmark for everyone/i }))
      .toBeDisabled();
  });

  it('should enable pin-for-everyone in the modal for admins', async () => {
    render(Page, {
      params: {},
      data: {
        user: null,
        storageBrowserEnabled: true,
        isAdmin: true,
        serviceCount: 0,
        healthy: true
      },
      form: null
    });

    await page.getByRole('button', { name: 'Add Bookmark' }).click();

    await expect
      .element(page.getByRole('checkbox', { name: /pin bookmark for everyone/i }))
      .toBeEnabled();
  });
});
