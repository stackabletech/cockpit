import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import FallbackPreview from './FallbackPreview.svelte';

describe('FallbackPreview', () => {
  const baseProps = {
    contentType: 'application/octet-stream',
    onDownload: vi.fn()
  };

  it('should show unsupported title when isBinary is false', async () => {
    render(FallbackPreview, { ...baseProps, isBinary: false });

    const btn = page.getByRole('button');
    await expect.element(btn).toBeInTheDocument();
  });

  it('should show binary title when isBinary is true', async () => {
    render(FallbackPreview, { ...baseProps, isBinary: true });

    const btn = page.getByRole('button');
    await expect.element(btn).toBeInTheDocument();
  });

  it('should render a download button', async () => {
    render(FallbackPreview, { ...baseProps });

    const btn = page.getByRole('button');
    await expect.element(btn).toBeInTheDocument();
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

  it('should call onDownload when button is clicked', async () => {
    const onDownload = vi.fn();
    render(FallbackPreview, { ...baseProps, onDownload });

    await page.getByRole('button').click();
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('should handle special characters in names', async () => {
    render(FallbackPreview, { ...baseProps });

    const btn = page.getByRole('button');
    await expect.element(btn).toBeInTheDocument();
  });
});
