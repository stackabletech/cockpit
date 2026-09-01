import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StorageSearchWrapper from './StorageSearchWrapper.svelte';
import { StorageState } from '$lib/storage/state.svelte.js';
import type { StorageApi } from '$lib/storage/api.js';
import type { RecentSearchEntry, StorageSearchResponse } from '$lib/storage/types.js';

const { goto, invalidateAll } = vi.hoisted(() => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto, invalidateAll }));
vi.mock('$app/paths', () => ({
  resolve: (_route: string, params: { bucket: string; prefix: string }) =>
    `/storage/${params.bucket}/${params.prefix}`
}));

type SearchApiMock = {
  search: ReturnType<typeof vi.fn>;
  listRecentSearches: ReturnType<typeof vi.fn>;
  recordRecentSearch: ReturnType<typeof vi.fn>;
  clearRecentSearches: ReturnType<typeof vi.fn>;
};

function createState(options?: {
  history?: RecentSearchEntry[];
  response?: StorageSearchResponse;
}): { state: StorageState; api: SearchApiMock } {
  const api = {
    search: vi.fn().mockResolvedValue(options?.response ?? { results: [], truncated: false }),
    listRecentSearches: vi.fn().mockResolvedValue(options?.history ?? []),
    recordRecentSearch: vi.fn().mockResolvedValue(undefined),
    clearRecentSearches: vi.fn().mockResolvedValue(undefined)
  } satisfies SearchApiMock;
  return {
    state: new StorageState({
      connected: true,
      buckets: ['alpha', 'beta'],
      api: api as unknown as StorageApi
    }),
    api
  };
}

describe('StorageSearch', () => {
  it('opens with the explorer bucket selected', async () => {
    const explorer = createState();
    render(StorageSearchWrapper, { state: explorer.state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await expect.element(page.getByLabelText('Bucket')).toHaveValue('alpha');
  });

  it('opens landing search without a scope and disables submission', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await expect.element(page.getByLabelText('Bucket')).toHaveValue('');
    await expect.element(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
  });

  it('shows and clears recent searches, and repeats a selected search', async () => {
    const history = [
      { bucket: 'alpha', query: 'one' },
      { bucket: 'alpha', query: 'two' },
      { bucket: 'beta', query: 'three' },
      { bucket: 'beta', query: 'four' }
    ];
    const { state, api } = createState({ history });
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await expect.element(page.getByText('four')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect.element(page.getByText('four')).toBeInTheDocument();
    await page.getByRole('button', { name: 'Clear recent searches' }).click();
    await expect.poll(() => api.clearRecentSearches.mock.calls.length).toBe(1);
    await expect
      .element(page.getByText('Your recent searches will appear here.'))
      .toBeInTheDocument();

    api.listRecentSearches.mockResolvedValue(history);
    await page.getByRole('button', { name: 'Close search' }).click();
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('button', { name: 'two' }).click();
    await expect.poll(() => api.search.mock.calls.length).toBe(1);
    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'alpha', query: 'two' })
    );
  });

  it('renders truncated results and opens directories or file previews', async () => {
    const { state, api } = createState({
      response: {
        truncated: true,
        results: [
          { key: 'reports/', size: 0, lastModified: new Date(), isDirectory: true },
          { key: 'reports/data.csv', size: 1, lastModified: new Date(), isDirectory: false }
        ]
      }
    });
    const preview = vi.spyOn(state, 'openModal');
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByLabelText('Search query').fill('report');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect
      .element(page.getByText('Only the first matching results are shown.'))
      .toBeInTheDocument();
    await page.getByRole('button', { name: /reports alpha\/reports\/$/ }).click();
    expect(goto).toHaveBeenCalledWith('/storage/alpha/reports');

    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).last().click();
    await page.getByLabelText('Search query').last().fill('data');
    await page.getByRole('button', { name: 'Search', exact: true }).last().click();
    await page.getByRole('button', { name: 'data.csv' }).click();
    expect(preview).toHaveBeenCalledWith('preview', { key: 'reports/data.csv', bucket: 'alpha' });
    expect(api.search).toHaveBeenCalled();
  });
});
