import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import CsvPreview from './CsvPreview.svelte';

describe('CsvPreview', () => {
  it('should show empty state when input is empty', async () => {
    render(CsvPreview, { text: '' });

    await expect.element(page.getByText('This bucket is empty')).toBeInTheDocument();
  });

  it('should show empty state when input is just a newline', async () => {
    render(CsvPreview, { text: '\n' });

    await expect.element(page.getByText('This bucket is empty')).toBeInTheDocument();
  });

  it('should render a table with headers and rows for basic CSV', async () => {
    const csv = 'name,city,score\nAlice,Berlin,95\nBob,Munich,88';
    render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'name' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'city' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'score' })).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'Berlin' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: '95' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'Bob' })).toBeInTheDocument();
  });

  it('should render TSV data correctly using tab separator', async () => {
    const tsv = 'name\tcity\tscore\nAlice\tBerlin\t95\nBob\tMunich\t88';
    render(CsvPreview, { text: tsv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'name' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'city' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'score' })).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'Berlin' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: '95' })).toBeInTheDocument();
  });

  it('keeps TSV columns wide enough for their content', async () => {
    const tsv = 'name\tdescription\nAlice\tA description that needs horizontal space';
    const { container } = render(CsvPreview, { text: tsv });

    const table = container.querySelector('table');
    expect(table?.className).toContain('min-w-max');
  });

  it('should handle CSV with quoted fields containing commas', async () => {
    const csv =
      'name,address,country\n"Smith, John","123 Main St, Apt 4",Germany\n"Doe, Jane","456 Oak Ave",Austria';
    render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'Smith, John' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: '123 Main St, Apt 4' }))
      .toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'Germany' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'Doe, Jane' })).toBeInTheDocument();
  });

  it('should handle TSV with quoted fields containing tabs', async () => {
    const tsv = 'name\tnote\nAlice\t"likes\ttabs"\nBob\tplain';
    render(CsvPreview, { text: tsv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'likes tabs' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'Bob' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'plain' })).toBeInTheDocument();
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

    // nth(1) to skip the line-number cell, get the data cell
    await expect
      .element(page.getByRole('cell', { name: '1', exact: true }).nth(1))
      .toBeInTheDocument();
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
    const notice = page.getByText('Showing first 250 rows');
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
    await expect
      .element(page.getByRole('cell', { name: '1', exact: true }).nth(1))
      .toBeInTheDocument();
    // There should be 3 data cells + 1 line number cell in the body row
    const rows = page.getByRole('row');
    // row 0 is header, row 1 is data
    const dataCells = rows.nth(1).getByRole('cell');
    // Line number cell
    await expect.element(dataCells.nth(0)).toHaveTextContent('1');
    // Column A: value '1'
    await expect.element(dataCells.nth(1)).toHaveTextContent('1');
    // Column B: missing, renders as empty
    await expect.element(dataCells.nth(2)).toHaveTextContent(/^$/);
    // Column C: missing, renders as empty
    await expect.element(dataCells.nth(3)).toHaveTextContent(/^$/);
  });

  it('should handle header-only CSV', async () => {
    const text = 'Name,Email,City';
    render(CsvPreview, { text });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();
    await expect.element(page.getByText('Name')).toBeInTheDocument();
  });

  it('should handle headers with special characters', async () => {
    const csv = 'first name,last.name,email-address\nJohn,Doe,john@example.com';
    render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    for (const header of ['first name', 'last.name', 'email-address']) {
      await expect.element(page.getByRole('cell', { name: header })).toBeInTheDocument();
    }
  });

  it('should handle rows with missing trailing columns', async () => {
    const csv = 'a,b,c\n1,2\n3,4,5,6';
    render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    const row1 = table.getByRole('row').nth(1);
    await expect(row1.getByRole('cell').nth(2)).toHaveTextContent('2');
    await expect(row1.getByRole('cell').nth(3)).toHaveTextContent('');

    const row2 = table.getByRole('row').nth(2);
    await expect(row2.getByRole('cell').nth(3)).toHaveTextContent('5');
  });

  it('should handle rows with empty quoted fields', async () => {
    const csv = 'a,b,c\n1,"",3\nx,y,z';
    render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    const row1 = page.getByRole('row').nth(1);
    await expect(row1.getByRole('cell').nth(1)).toHaveTextContent('1');
    await expect(row1.getByRole('cell').nth(3)).toHaveTextContent('3');
  });

  it('should handle CRLF line endings', async () => {
    const csv = 'name,city\r\nAlice,Berlin\r\nBob,Munich\r\n';
    render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'Bob' })).toBeInTheDocument();
  });

  it('should render single row CSV correctly', async () => {
    const csv = 'header\nvalue';
    render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    await expect.element(page.getByRole('cell', { name: 'header' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'value' })).toBeInTheDocument();
  });

  it('should not show truncation message when rows fit within limit', async () => {
    const rows = ['h1,h2'];
    for (let i = 0; i < 10; i++) {
      rows.push(`val${i}a,val${i}b`);
    }
    const csv = rows.join('\n');
    render(CsvPreview, { text: csv });

    const truncationMsg = page.getByText(/Showing/i);
    expect(await truncationMsg.all()).toHaveLength(0);
  });

  it('should show truncation message when rows exceed MAX_ROWS', async () => {
    const rows = ['h1,h2'];
    for (let i = 0; i < 260; i++) {
      rows.push(`val${i}a,val${i}b`);
    }
    const csv = rows.join('\n');
    render(CsvPreview, { text: csv });

    await expect.element(page.getByText(/Showing/i)).toBeInTheDocument();
  });

  it('should show truncation message for TSV with many rows', async () => {
    const rows = ['h1\th2'];
    for (let i = 0; i < 260; i++) {
      rows.push(`val${i}a\tval${i}b`);
    }
    const tsv = rows.join('\n');
    render(CsvPreview, { text: tsv });

    await expect.element(page.getByText(/Showing/i)).toBeInTheDocument();
  });

  it('should render exactly MAX_ROWS rows when truncated', async () => {
    const rows = ['h1'];
    for (let i = 0; i < 300; i++) {
      rows.push(`val${i}`);
    }
    const csv = rows.join('\n');
    const { container } = render(CsvPreview, { text: csv });

    const table = page.getByRole('table', { name: 'CSV preview' });
    await expect.element(table).toBeInTheDocument();

    const tables = await container.getElementsByTagName('table');
    expect(tables.length).toBe(1);
    expect(tables[0].rows.length).toBe(251);
  });
});
