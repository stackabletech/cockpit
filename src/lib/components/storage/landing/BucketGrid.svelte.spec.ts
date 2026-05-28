import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import BucketGrid from './BucketGrid.svelte';

describe('BucketGrid', () => {
  it('should show empty message when no buckets provided', async () => {
    render(BucketGrid);
    await expect.element(page.getByText('No buckets found')).toBeInTheDocument();
  });

  it('should show empty message when buckets array is empty', async () => {
    render(BucketGrid, { buckets: [] });
    await expect.element(page.getByText('No buckets found')).toBeInTheDocument();
  });

  it('should render bucket links when buckets are provided', async () => {
    const buckets = ['my-bucket', 'other-bucket'];
    render(BucketGrid, { buckets });

    const links = page.getByRole('link');
    await expect.element(links.nth(0)).toBeInTheDocument();
    await expect.element(links.nth(1)).toBeInTheDocument();
  });

  it('should display bucket name in each link', async () => {
    const buckets = ['data-lake', 'backups'];
    render(BucketGrid, { buckets });

    await expect.element(page.getByText('data-lake')).toBeInTheDocument();
    await expect.element(page.getByText('backups')).toBeInTheDocument();
  });

  it('should encode bucket names in href', async () => {
    const buckets = ['bucket with spaces'];
    render(BucketGrid, { buckets });

    const link = page.getByRole('link');
    await expect
      .element(link)
      .toHaveAttribute('href', expect.stringContaining('bucket%20with%20spaces'));
  });

  it('should handle special characters in bucket names', async () => {
    const buckets = ['my-bucket/special', 'name+plus', 'unicode-ñ-ü'];
    render(BucketGrid, { buckets });

    await expect.element(page.getByText('my-bucket/special')).toBeInTheDocument();
    await expect.element(page.getByText('name+plus')).toBeInTheDocument();
    await expect.element(page.getByText('unicode-ñ-ü')).toBeInTheDocument();
  });

  it('should have tooltip with bucket name', async () => {
    const buckets = ['tooltip-bucket'];
    render(BucketGrid, { buckets });

    const tooltip = page.getByText('tooltip-bucket').element().closest('[data-tip]');
    expect(tooltip?.getAttribute('data-tip')).toBe('tooltip-bucket');
  });

  it('should render a large number of buckets', async () => {
    const buckets = Array.from({ length: 100 }, () => faker.string.alphanumeric(10));
    render(BucketGrid, { buckets });

    const links = page.getByRole('link');
    await expect.element(links.nth(99)).toBeInTheDocument();
  });

  it('should handle very long bucket names', async () => {
    const longName = faker.string.alphanumeric(200);
    render(BucketGrid, { buckets: [longName] });

    await expect.element(page.getByText(longName)).toBeInTheDocument();
  });

  it('should handle unicode bucket names', async () => {
    const buckets = ['日本語バケット', '中文桶', 'émojis-🪣'];
    render(BucketGrid, { buckets });

    await expect.element(page.getByText('日本語バケット')).toBeInTheDocument();
    await expect.element(page.getByText('中文桶')).toBeInTheDocument();
    await expect.element(page.getByText('émojis-🪣')).toBeInTheDocument();
  });
});
