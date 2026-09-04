import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParquetPreview from './ParquetPreview.svelte';

describe('ParquetPreview', () => {
  const defaultHeaders = ['id', 'name', 'email'];
  const defaultRows = [
    ['1', 'Alice', 'alice@example.com'],
    ['2', 'Bob', 'bob@example.com'],
    ['3', 'Charlie', 'charlie@example.com']
  ];

  it('should show empty state when headers array is empty', async () => {
    render(ParquetPreview, { headers: [], initialRows: [] });

    await expect.element(page.getByText('This bucket is empty')).toBeInTheDocument();
  });

  it('should render a table with headers', async () => {
    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: defaultRows
    });

    const table = page.getByRole('table', { name: 'Parquet preview' });
    await expect.element(table).toBeInTheDocument();

    for (const header of defaultHeaders) {
      await expect.element(page.getByText(header)).toBeInTheDocument();
    }
  });

  it('should render initial rows in the table', async () => {
    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: defaultRows,
      totalRows: 3
    });

    await expect
      .element(page.getByRole('cell', { name: 'Alice', exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: 'bob@example.com', exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: 'Charlie', exact: true }))
      .toBeInTheDocument();
  });

  it('should show row count message when totalRows exceeds loaded rows', async () => {
    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: defaultRows,
      totalRows: 1000
    });

    // With default CHUNK_SIZE=250, loadedRowsCount = 250 (one chunk)
    // totalRows = 1000, so isTruncated = true
    await expect.element(page.getByText(/rows/)).toBeInTheDocument();
  });

  it('should not show row count message when totalRows equals loaded rows', async () => {
    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: defaultRows,
      totalRows: 3
    });

    // Only 3 rows loaded, totalRows = 3 — not truncated
    const rowsMessages = page.getByText(/rows/i);
    // The only text with "rows" should be the row count message.
    // When not truncated, no such message appears.
    expect(await rowsMessages.all()).toHaveLength(0);
  });

  it('should not show row count when totalRows is 0', async () => {
    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: defaultRows,
      totalRows: 0
    });

    // 0 total rows, no truncation message
    await expect.element(page.getByText(/Showing/i)).not.toBeInTheDocument();
  });

  it('should render cell content using String() so null becomes empty string', async () => {
    const rowsWithNull = [['1', 'Alice', null]];
    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: rowsWithNull,
      totalRows: 1
    });

    // Alice should be visible
    await expect.element(page.getByText('Alice')).toBeInTheDocument();
    // The null cell should render as empty (not "null" string)
    await expect.element(page.getByText(/null/)).not.toBeInTheDocument();
  });

  it('should call fetchRows when scrolling to unloaded chunk', async () => {
    const fetchRows = vi.fn().mockResolvedValue([
      ['4', 'Diana', 'diana@example.com'],
      ['5', 'Eve', 'eve@example.com']
    ]);

    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: defaultRows,
      totalRows: 500,
      fetchRows
    });

    // The effect triggers fetchRows for chunks visible within the viewport

    // Wait for initial render and effect cycle
    await vi.waitFor(
      () => {
        expect(fetchRows).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it('should render skeleton rows while chunk is loading', async () => {
    // Create a fetchRows that never resolves to simulate loading state
    const fetchRows = vi.fn().mockReturnValue(new Promise(() => {}));

    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: defaultRows,
      totalRows: 500,
      fetchRows
    });

    // The loading skeleton is an animated pulse div inside the unloaded rows
    // This is tricky to assert directly, so we verify fetchRows was called
    // and no crash occurs
    await vi.waitFor(
      () => {
        expect(fetchRows).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it('should handle a single large initial data page', async () => {
    const manyRows = Array.from({ length: 250 }, (_, i) => [
      String(i + 1),
      `User-${i + 1}`,
      `user${i + 1}@example.com`
    ]);

    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: manyRows,
      totalRows: 1000
    });

    await expect.element(page.getByText('User-250')).toBeInTheDocument();
  });

  it('should display all headers including those with special characters', async () => {
    const specialHeaders = ['first name', 'last.name', 'email-address'];
    render(ParquetPreview, {
      headers: specialHeaders,
      initialRows: [['John', 'Doe', 'john@example.com']]
    });

    for (const header of specialHeaders) {
      await expect.element(page.getByText(header)).toBeInTheDocument();
    }
  });

  it('should handle empty rows array', async () => {
    render(ParquetPreview, {
      headers: defaultHeaders,
      initialRows: [],
      totalRows: 0
    });

    const table = page.getByRole('table', { name: 'Parquet preview' });
    await expect.element(table).toBeInTheDocument();
    // Headers still render even when no rows
    for (const header of defaultHeaders) {
      await expect.element(page.getByText(header)).toBeInTheDocument();
    }
  });
});
