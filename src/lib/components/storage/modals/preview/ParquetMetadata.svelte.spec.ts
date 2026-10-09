import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ParquetMetadata from './ParquetMetadata.svelte';

describe('ParquetMetadata', () => {
  const defaultColumnTypes = [
    {
      name: 'id',
      type: 'int64',
      codec: 'SNAPPY',
      compressedSize: 100,
      uncompressedSize: 500,
      stats: { nullCount: 0, distinctCount: 100, min: '1', max: '100' }
    },
    {
      name: 'name',
      type: 'string',
      codec: 'SNAPPY',
      compressedSize: 800,
      uncompressedSize: 2000,
      stats: { nullCount: 0, distinctCount: null, min: 'Alice', max: 'Bob' }
    },
    {
      name: 'score',
      type: 'double',
      codec: 'GZIP',
      compressedSize: 50,
      uncompressedSize: 300,
      stats: { nullCount: null, distinctCount: null, min: null, max: null }
    }
  ];

  const defaultMetadata = {
    rowGroups: 3,
    compressionCodecs: ['SNAPPY', 'GZIP'],
    compressionUniform: false,
    hasOffsetIndex: true,
    hasColumnIndex: false,
    createdBy: 'pyarrow',
    version: 2,
    arrowSchema: null
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

  it('should render schema table with column types, compression, sizes and stats', async () => {
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

    // Per-column compression
    await expect.element(page.getByText('SNAPPY').first()).toBeInTheDocument();
    await expect.element(page.getByText('GZIP').first()).toBeInTheDocument();

    // Stats labels
    await expect.element(page.getByText('Min').first()).toBeInTheDocument();
    await expect.element(page.getByText('Max').first()).toBeInTheDocument();
    await expect.element(page.getByText('Null count').first()).toBeInTheDocument();
    await expect.element(page.getByText('Distinct count').first()).toBeInTheDocument();
    // Stats values for id column
    await expect.element(page.getByText('1').first()).toBeInTheDocument();
    await expect.element(page.getByText('100').first()).toBeInTheDocument();

    // Not stored for score column (no stats)
    await expect.element(page.getByText('Not stored')).toBeInTheDocument();
  });

  it('should render compression and indexes section', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [defaultColumnTypes[0]],
      totalRows: 100,
      totalSize: 2000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('Compression & Indexes').first()).toBeInTheDocument();
    await expect.element(page.getByText('SNAPPY').first()).toBeInTheDocument();
    await expect.element(page.getByText('GZIP')).toBeInTheDocument();
    await expect.element(page.getByText('Available')).toBeInTheDocument();
    await expect.element(page.getByText('Missing')).toBeInTheDocument();
  });

  it('should show uniform label when compression is uniform', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [
        {
          ...defaultColumnTypes[0],
          codec: 'SNAPPY'
        }
      ],
      totalRows: 100,
      totalSize: 2000,
      metadata: { ...defaultMetadata, compressionCodecs: ['SNAPPY'], compressionUniform: true }
    });

    await expect.element(page.getByText('uniform')).toBeInTheDocument();
  });

  it('should render row groups section when rowGroups > 0', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [defaultColumnTypes[0]],
      totalRows: 100,
      totalSize: 2000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('Row groups').first()).toBeInTheDocument();
  });

  it('should render created by when present', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [defaultColumnTypes[0]],
      totalRows: 100,
      totalSize: 2000,
      metadata: defaultMetadata
    });

    await expect.element(page.getByText('pyarrow')).toBeInTheDocument();
  });

  it('should show Arrow schema section when present', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [defaultColumnTypes[0]],
      totalRows: 100,
      totalSize: 2000,
      metadata: { ...defaultMetadata, arrowSchema: 'id, name, score' }
    });

    await expect.element(page.getByText('Arrow schema').first()).toBeInTheDocument();

    // Click "Show" to reveal the arrow schema content
    const showBtn = page.getByRole('button', { name: 'Show' });
    await expect.element(showBtn).toBeInTheDocument();
    await showBtn.click();

    await expect.element(page.getByText('id, name, score')).toBeInTheDocument();
  });

  it('should handle empty column types', async () => {
    render(ParquetMetadata, {
      headers: [],
      columnTypes: [],
      totalRows: 0,
      totalSize: 0,
      metadata: { ...defaultMetadata, rowGroups: 0, arrowSchema: null }
    });

    await expect.element(page.getByText('Overview')).toBeInTheDocument();
    await expect.element(page.getByText('0 B')).toBeInTheDocument();
  });

  it('should show None for empty compression codecs', async () => {
    render(ParquetMetadata, {
      headers: ['id'],
      columnTypes: [
        {
          ...defaultColumnTypes[0],
          codec: 'SNAPPY',
          compressedSize: 0,
          uncompressedSize: 0,
          stats: { nullCount: null, distinctCount: null, min: null, max: null }
        }
      ],
      totalRows: 100,
      totalSize: 2000,
      metadata: { ...defaultMetadata, compressionCodecs: [] }
    });

    await expect.element(page.getByText('None')).toBeInTheDocument();
  });
});
