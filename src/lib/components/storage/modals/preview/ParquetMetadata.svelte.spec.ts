import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParquetMetadata from './ParquetMetadata.svelte';

describe('ParquetMetadata', () => {
  const defaultColumnTypes = [
    { name: 'id', type: 'int64' },
    { name: 'name', type: 'string' },
    { name: 'score', type: 'double' }
  ];

  const defaultMetadata = {
    rowGroups: 3,
    compressionCodecs: ['SNAPPY', 'GZIP'],
    hasOffsetIndex: true,
    hasColumnIndex: false,
    createdBy: 'pyarrow',
    version: 2
  };

  it('should render file overview', async () => {
    render(ParquetMetadata, {
      headers: ['id', 'name', 'score'],
      columnTypes: defaultColumnTypes,
      totalRows: 1000,
      totalSize: 50000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('Overview')).toBeInTheDocument();
    await expect.element(page.getByText('File size')).toBeInTheDocument();
    await expect.element(page.getByText('Total rows')).toBeInTheDocument();
    await expect.element(page.getByText('1,000')).toBeInTheDocument();
  });

  it('should render schema table with column types', async () => {
    render(ParquetMetadata, {
      headers: ['id', 'name', 'score'],
      columnTypes: defaultColumnTypes,
      totalRows: 1000,
      totalSize: 50000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('Schema')).toBeInTheDocument();
    await expect.element(page.getByText('id')).toBeInTheDocument();
    await expect.element(page.getByText('name')).toBeInTheDocument();
    await expect.element(page.getByText('score')).toBeInTheDocument();
    await expect.element(page.getByText('int64')).toBeInTheDocument();
    await expect.element(page.getByText('string')).toBeInTheDocument();
    await expect.element(page.getByText('double')).toBeInTheDocument();
  });

  it('should render compression and indexes section', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [{ name: 'id', type: 'int64' }],
      totalRows: 100,
      totalSize: 2000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('Compression & Indexes')).toBeInTheDocument();
    await expect.element(page.getByText('SNAPPY')).toBeInTheDocument();
    await expect.element(page.getByText('GZIP')).toBeInTheDocument();
    await expect.element(page.getByText('Available')).toBeInTheDocument();
    await expect.element(page.getByText('Missing')).toBeInTheDocument();
  });

  it('should render row groups section when rowGroups > 0', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [{ name: 'id', type: 'int64' }],
      totalRows: 100,
      totalSize: 2000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('Row groups')).toBeInTheDocument();
  });

  it('should render created by when present', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [{ name: 'id', type: 'int64' }],
      totalRows: 100,
      totalSize: 2000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('pyarrow')).toBeInTheDocument();
  });

  it('should show None for empty compression codecs', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [{ name: 'id', type: 'int64' }],
      totalRows: 100,
      totalSize: 2000,
      metadata: { ...defaultMetadata, compressionCodecs: [] }
    });

    await expect.element(page.getByText('None')).toBeInTheDocument();
  });

  it('should handle empty column types', async () => {
    render(ParquetMetadata, {
      headers: [],
      columnTypes: [],
      totalRows: 0,
      totalSize: 0,
      metadata: { ...defaultMetadata, rowGroups: 0 }
    });

    await expect.element(page.getByText('Overview')).toBeInTheDocument();
    await expect.element(page.getByText('0 B')).toBeInTheDocument();
  });
});
