import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import ImagePreview from './ImagePreview.svelte';

describe('ImagePreview', () => {
  it('should render an img element with correct alt text', async () => {
    const name = 'photo.png';
    render(ImagePreview, { src: 'blob:http://localhost/fake-id', name });

    const img = page.getByRole('img');
    await expect.element(img).toBeInTheDocument();
    await expect.element(img).toHaveAttribute('alt');
  });

  it('should have the expected CSS classes', async () => {
    render(ImagePreview, { src: 'blob:http://localhost/fake-id', name: 'test.jpg' });

    const img = page.getByRole('img');
    await expect.element(img).toHaveClass('max-h-full max-w-full rounded object-contain shadow');
  });

  it('should set the src attribute', async () => {
    const src = 'blob:http://localhost/abc-123';
    render(ImagePreview, { src, name: 'image.png' });

    const img = page.getByRole('img');
    await expect.element(img).toHaveAttribute('src', src);
  });

  it('should handle various file names', async () => {
    const name = `${faker.string.alphanumeric(20)}.${faker.helpers.arrayElement(['png', 'jpg', 'gif', 'webp'])}`;
    render(ImagePreview, { src: 'blob:http://localhost/id', name });

    const img = page.getByRole('img');
    await expect.element(img).toBeInTheDocument();
  });
});
