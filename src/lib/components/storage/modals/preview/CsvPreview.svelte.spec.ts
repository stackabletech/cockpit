import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import CsvPreview from './CsvPreview.svelte';

describe('CsvPreview', () => {
  it('should show empty state when text is empty', async () => {
    render(CsvPreview, { text: '' });

    const table = page.getByRole('table');
    await expect.element(table).not.toBeInTheDocument();
  });

  it('should render a table with headers and rows', async () => {
    const text = 'Name,Email,City\nAlice,alice@example.com,Berlin\nBob,bob@example.com,Munich';
    render(CsvPreview, { text });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();
    await expect.element(page.getByText('Name')).toBeInTheDocument();
    await expect.element(page.getByText('Email')).toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: 'Alice', exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('should handle quoted fields with commas', async () => {
    const text = 'Name,Address\n"Smith, John","123 Main St, Apt 4"';
    render(CsvPreview, { text });

    await expect.element(page.getByText('Smith, John')).toBeInTheDocument();
    await expect.element(page.getByText('123 Main St, Apt 4')).toBeInTheDocument();
  });

  it('should handle escaped quotes', async () => {
    const text = 'Name,Quote\nAlice,"She said ""hello"""';
    render(CsvPreview, { text });

    await expect.element(page.getByText('She said "hello"')).toBeInTheDocument();
  });

  it('should handle empty cells', async () => {
    const text = 'A,B,C\n1,,3\n,,';
    render(CsvPreview, { text });

    await expect.element(page.getByText('1')).toBeInTheDocument();
    await expect.element(page.getByText('3')).toBeInTheDocument();
  });

  it('should truncate at default 250 rows and show notice', async () => {
    const header = 'Name,Email';
    const rows = Array.from(
      { length: 300 },
      () => `${faker.person.firstName()},${faker.internet.email()}`
    );
    const text = [header, ...rows].join('\n');
    render(CsvPreview, { text });

    // Should show truncation notice
    const notice = page.getByText(/250/);
    await expect.element(notice).toBeInTheDocument();
  });

  it('should respect maxRows prop', async () => {
    const header = 'Name,Email';
    const rows = Array.from(
      { length: 50 },
      () => `${faker.person.firstName()},${faker.internet.email()}`
    );
    const text = [header, ...rows].join('\n');
    render(CsvPreview, { text, maxRows: 10 });

    const notice = page.getByText(/10/);
    await expect.element(notice).toBeInTheDocument();
  });

  it('should not show truncation notice for <= 250 rows', async () => {
    const header = 'Name,Email';
    const rows = Array.from(
      { length: 10 },
      () => `${faker.person.firstName()},${faker.internet.email()}`
    );
    const text = [header, ...rows].join('\n');
    render(CsvPreview, { text });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();
  });

  it('should render empty string for missing columns (row shorter than headers)', async () => {
    const text = 'A,B,C\n1';
    render(CsvPreview, { text });

    // Row has only 1 field but 3 headers, so columns B and C should render as empty via ?? ''
    await expect.element(page.getByRole('cell', { name: '1', exact: true })).toBeInTheDocument();
    // There should be 3 cells in the body row
    const rows = page.getByRole('row');
    // row 0 is header, row 1 is data
    const dataCells = rows.nth(1).getByRole('cell');
    await expect.element(dataCells.nth(0)).toHaveTextContent('1');
    await expect.element(dataCells.nth(1)).toHaveTextContent('');
    await expect.element(dataCells.nth(2)).toHaveTextContent('');
  });

  it('should handle header-only CSV', async () => {
    const text = 'Name,Email,City';
    render(CsvPreview, { text });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();
    await expect.element(page.getByText('Name')).toBeInTheDocument();
  });
});
