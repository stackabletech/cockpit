import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProductIcon from './ProductIcon.svelte';
import { getProduct } from '$lib/dashboard/products';

describe('ProductIcon', () => {
  it('renders the logo when the product has one', async () => {
    const { container } = render(ProductIcon, { product: getProduct('trino'), alt: 'Trino' });

    await expect.element(page.getByRole('img', { name: 'Trino' })).toBeInTheDocument();
    expect(container.querySelector('picture')).not.toBeNull();
  });

  it('renders the initials badge with the product colours when there is no logo', async () => {
    const product = getProduct('custom');
    const { container } = render(ProductIcon, { product });

    const badge = container.querySelector('span')!;
    expect(badge.textContent?.trim()).toBe('CL');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.style.color).toBe('rgb(255, 255, 255)');
  });

  it('switches to the initials badge when the logo fails to load', async () => {
    const product = getProduct('druid');
    const { container } = render(ProductIcon, { product, alt: 'Druid' });

    container.querySelector('img')!.dispatchEvent(new Event('error'));

    const badge = page.getByRole('img', { name: 'Druid' });
    await expect.element(badge).toHaveTextContent('DR');
    // Druid's light brand colour needs dark initials for AA contrast.
    await expect.element(badge).toHaveStyle({ color: 'rgb(0, 0, 0)' });
    expect(container.querySelector('picture')).toBeNull();
  });
});
