import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import FallbackPreview from './FallbackPreview.svelte';

describe('FallbackPreview', () => {
  const baseProps = {
    contentType: 'application/octet-stream',
    downloadUrl: '/download/file.bin',
    name: 'file.bin'
  };

  it('should show unsupported title when isBinary is false', async () => {
    render(FallbackPreview, { ...baseProps, isBinary: false });

    // Find the download link as a reliable anchor
    const link = page.getByRole('link');
    await expect.element(link).toBeInTheDocument();
    await expect.element(link).toHaveAttribute('download', 'file.bin');
  });

  it('should show binary title when isBinary is true', async () => {
    render(FallbackPreview, { ...baseProps, isBinary: true });

    const link = page.getByRole('link');
    await expect.element(link).toBeInTheDocument();
  });

  it('should render download link with correct attributes', async () => {
    render(FallbackPreview, { ...baseProps });

    const link = page.getByRole('link');
    await expect.element(link).toHaveAttribute('href', '/download/file.bin');
    await expect.element(link).toHaveAttribute('download', 'file.bin');
  });

  it('should show contentType in mono text', async () => {
    const contentType = 'application/x-custom-binary';
    render(FallbackPreview, { ...baseProps, contentType });

    await expect.element(page.getByText(contentType)).toBeInTheDocument();
  });

  it('should handle various MIME types', async () => {
    const mimeType = faker.system.mimeType();
    render(FallbackPreview, { ...baseProps, contentType: mimeType });

    await expect.element(page.getByText(mimeType)).toBeInTheDocument();
  });

  it('should handle long filenames', async () => {
    const name = `${faker.string.alphanumeric(100)}.dat`;
    render(FallbackPreview, { ...baseProps, name });

    const link = page.getByRole('link');
    await expect.element(link).toHaveAttribute('download', name);
  });

  it('should handle special characters in names', async () => {
    const name = 'file (copy) [2].bin';
    render(FallbackPreview, { ...baseProps, name });

    const link = page.getByRole('link');
    await expect.element(link).toHaveAttribute('download', name);
  });
});
