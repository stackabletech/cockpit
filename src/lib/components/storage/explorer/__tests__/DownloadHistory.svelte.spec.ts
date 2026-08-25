import '../../../../../app.css';
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DownloadHistory from '../DownloadHistory.svelte';
import type { DownloadHistoryEntry } from '$lib/storage/api.js';

function makeEntry(overrides: Partial<DownloadHistoryEntry> = {}): DownloadHistoryEntry {
  return {
    id: 'entry-1',
    bucket: 'test-bucket',
    connectionId: 'connection-1',
    entries: [
      { key: 'reports/one.txt', size: 1024, isDirectory: false },
      { key: 'reports/two.txt', size: 2048, isDirectory: false }
    ],
    archive: true,
    archiveFilename: 'test-bucket.zip',
    createdAt: new Date('2026-08-24T10:00:00Z').toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides
  };
}

function renderHistory(entries: DownloadHistoryEntry[], onDownload = vi.fn(async () => {})) {
  const { container, unmount } = render(DownloadHistory, { entries, onDownload });
  const section = container.querySelector('section') as HTMLElement;
  // Constrain to the operations dropdown panel width.
  section.style.width = '384px';
  return { section, onDownload, unmount };
}

describe('DownloadHistory', () => {
  it('shows the empty state when there are no entries', async () => {
    renderHistory([]);
    await expect.element(page.getByText('No downloads in the last 30 days.')).toBeInTheDocument();
  });

  it('renders entry metadata with file count and archive format', async () => {
    renderHistory([makeEntry()]);
    await expect.element(page.getByText('test-bucket')).toBeInTheDocument();
    await expect.element(page.getByText('2 files')).toBeInTheDocument();
    await expect.element(page.getByText('ZIP')).toBeInTheDocument();
  });

  it('expands details and reports the number of selected files', async () => {
    renderHistory([makeEntry()]);
    await page.getByRole('button', { name: 'Show details' }).click();

    const checkboxes = page.getByRole('checkbox');
    await expect.element(checkboxes).toHaveLength(2);

    await page.getByLabelText(/reports\/one\.txt/).click();
    await expect.element(page.getByText('1 selected')).toBeInTheDocument();

    await page.getByLabelText(/reports\/one\.txt/).click();
    await expect.element(page.getByText('0 selected')).toBeInTheDocument();
  });

  it('downloads the selected keys via the callback', async () => {
    const onDownload = vi.fn(async () => {});
    renderHistory([makeEntry()], onDownload);
    await page.getByRole('button', { name: 'Show details' }).click();
    await page.getByLabelText(/reports\/two\.txt/).click();

    await page.getByRole('button', { name: 'Download selected' }).click();

    await vi.waitFor(() => expect(onDownload).toHaveBeenCalledWith('entry-1', ['reports/two.txt']));
    await expect
      .element(page.getByRole('button', { name: 'Download selected' }))
      .not.toBeDisabled();
  });

  it('only lists files in expanded details', async () => {
    renderHistory([
      makeEntry({
        entries: [
          { key: 'reports/', size: 0, isDirectory: true },
          { key: 'reports/one.txt', size: 1024, isDirectory: false }
        ]
      })
    ]);
    await page.getByRole('button', { name: 'Show details' }).click();

    await expect.element(page.getByRole('checkbox')).toHaveLength(1);
    await expect.element(page.getByLabelText(/reports\/one\.txt/)).toBeInTheDocument();
    await expect.element(page.getByText('reports/', { exact: true })).not.toBeInTheDocument();
  });

  it('does not overflow horizontally with a long unbreakable object key', async () => {
    const longKey = `very-long-object-name-${'x'.repeat(120)}.bin`;
    const { section } = renderHistory([
      makeEntry({ entries: [{ key: longKey, size: 123_456, isDirectory: false }] })
    ]);
    await page.getByRole('button', { name: 'Show details' }).click();
    await expect.element(page.getByText(/0 selected/)).toBeInTheDocument();

    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
  });

  it('does not overflow horizontally with a very long bucket name', async () => {
    const { section } = renderHistory([
      makeEntry({ bucket: `extremely-long-bucket-name-${'y'.repeat(120)}` })
    ]);
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
  });
});
