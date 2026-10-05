import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import PdfPreview from './PdfPreview.svelte';

describe('PdfPreview', () => {
  it('should render an iframe', async () => {
    render(PdfPreview, { src: 'blob:http://localhost/fake-pdf', name: 'report.pdf' });

    const iframe = page.getByTitle(/report\.pdf/);
    await expect.element(iframe).toBeInTheDocument();
  });

  it('should have correct CSS classes', async () => {
    render(PdfPreview, { src: 'blob:http://localhost/fake-pdf', name: 'doc.pdf' });

    const iframe = page.getByTitle(/doc\.pdf/);
    await expect.element(iframe).toHaveClass('h-full w-full rounded border-0');
  });

  it('should set the src attribute', async () => {
    const src = 'blob:http://localhost/pdf-123';
    render(PdfPreview, { src, name: 'file.pdf' });

    const iframe = page.getByTitle(/file\.pdf/);
    await expect.element(iframe).toHaveAttribute('src', src);
  });

  it('should have an aria-label', async () => {
    render(PdfPreview, { src: 'blob:http://localhost/id', name: 'test.pdf' });

    const iframe = page.getByTitle(/test\.pdf/);
    await expect.element(iframe).toHaveAttribute('aria-label');
  });

  it('should handle various file names', async () => {
    const name = `${faker.system.fileName()}.pdf`;
    render(PdfPreview, { src: 'blob:http://localhost/id', name });

    // eslint-disable-next-line security/detect-non-literal-regexp
    const iframe = page.getByTitle(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect.element(iframe).toBeInTheDocument();
  });
});
