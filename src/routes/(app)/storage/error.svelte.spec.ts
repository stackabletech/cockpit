import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mockPage = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  url: new URL('http://localhost/storage'),
  status: 500,
  error: null as App.Error | null
}));

vi.mock('$app/state', () => ({ page: mockPage }));

import ErrorPage from './+error.svelte';

function setPage(opts: {
  pathname: string;
  params?: Record<string, string | undefined>;
  status: number;
  message?: string;
  error?: Partial<App.Error>;
}) {
  mockPage.url = new URL(`http://localhost${opts.pathname}`);
  mockPage.params = opts.params ?? {};
  mockPage.status = opts.status;
  mockPage.error = { message: opts.message ?? 'Generic error', ...opts.error };
}

describe('/(app)/storage/+error.svelte', () => {
  beforeEach(() => {
    setPage({ pathname: '/storage', status: 500 });
  });

  it('uses the bucket from route params when available', async () => {
    setPage({
      pathname: '/storage/browse/conn-1/my-bucket/a/b',
      params: { connection: 'conn-1', bucket: 'my-bucket', prefix: 'a/b' },
      status: 404
    });
    render(ErrorPage);

    await expect
      .element(page.getByText('The bucket “my-bucket” does not exist.'))
      .toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'my-bucket' })).toBeInTheDocument();
  });

  it('explains that a link points to a storage that is not connected', async () => {
    setPage({
      pathname: '/storage/browse/other.example/my-bucket',
      params: { connection: 'other.example', bucket: 'my-bucket' },
      status: 404,
      error: { reason: 'not-connected', connection: 'other.example' }
    });
    render(ErrorPage);

    await expect
      .element(
        page.getByText('You are not connected to the storage “other.example”.', { exact: false })
      )
      .toBeInTheDocument();
    expect(page.getByText('does not exist', { exact: false }).elements()).toHaveLength(0);
  });

  it('falls back to the bucket in the URL when route params are missing', async () => {
    setPage({
      pathname: '/storage/browse/conn-1/my%20bucket/folder/sub',
      params: {},
      status: 403
    });
    render(ErrorPage);

    await expect
      .element(page.getByText('You do not have permission to access the bucket “my bucket”.'))
      .toBeInTheDocument();
    const link = page.getByRole('link', { name: 'my bucket' });
    await expect.element(link).toBeInTheDocument();
    await expect.element(link).toHaveAttribute('href', '/storage/browse/conn-1/my%20bucket');
    await expect.element(page.getByText('folder/sub')).toBeInTheDocument();
  });

  it('shows the server message and no bucket link when no bucket is known', async () => {
    setPage({ pathname: '/storage', status: 404, message: 'Not found' });
    render(ErrorPage);

    await expect.element(page.getByText('Not found')).toBeInTheDocument();
    await expect
      .element(page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('link'))
      .not.toBeInTheDocument();
  });

  it('does not throw on malformed percent-encoding in the URL', async () => {
    setPage({ pathname: '/storage/browse/conn-1/bad%E0bucket', params: {}, status: 404 });
    render(ErrorPage);

    await expect
      .element(page.getByText('The bucket “bad%E0bucket” does not exist.'))
      .toBeInTheDocument();
  });
});
