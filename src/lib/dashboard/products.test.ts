import { describe, expect, it } from 'vitest';
import { getProduct, PRODUCTS } from './products';

/** WCAG 2.1 relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('PRODUCTS', () => {
  it.each(PRODUCTS.map((p) => [p.id, p] as const))(
    '%s initials badge meets WCAG AA contrast (4.5:1)',
    (_id, product) => {
      expect(contrastRatio(product.textColor, product.color)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('falls back to the custom product for unknown ids', () => {
    expect(getProduct('does-not-exist').id).toBe('custom');
  });
});
