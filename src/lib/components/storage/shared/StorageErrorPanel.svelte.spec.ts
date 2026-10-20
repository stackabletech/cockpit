import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StorageErrorPanel from './StorageErrorPanel.svelte';

describe('StorageErrorPanel', () => {
  it('should render the status code as the heading', async () => {
    render(StorageErrorPanel, { status: 403, message: 'Access denied' });

    await expect.element(page.getByRole('heading', { name: '403' })).toBeInTheDocument();
  });

  it('should render the supplied message', async () => {
    render(StorageErrorPanel, { status: 404, message: 'No such bucket: reports' });

    await expect.element(page.getByText('No such bucket: reports')).toBeInTheDocument();
  });

  it('should tolerate an empty message', async () => {
    render(StorageErrorPanel, { status: 500, message: '' });

    await expect.element(page.getByRole('heading', { name: '500' })).toBeInTheDocument();
  });

  it('should offer a link back to storage', async () => {
    render(StorageErrorPanel, { status: 403, message: 'Access denied' });

    const link = page.getByRole('link', { name: /back to storage/i });
    await expect.element(link).toHaveAttribute('href', '/storage');
  });

  it('should offer a go-back button', async () => {
    render(StorageErrorPanel, { status: 403, message: 'Access denied' });

    await expect.element(page.getByRole('button', { name: /go back/i })).toBeInTheDocument();
  });
});
