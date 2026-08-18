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
  response?: StorageSearchResponse;
  history?: RecentSearchEntry[];
}): {
  state: StorageState;
  api: SearchApiMock;
} {
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
    await expect.element(page.getByRole('button', { name: 'alpha', exact: true })).toBeVisible();
  });

  it('searches every bucket from the landing page', async () => {
    const { state, api } = createState();
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByLabelText('Search query').fill('report');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => api.search.mock.calls.length).toBe(2);
    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'alpha', query: 'report' })
    );
    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'beta', query: 'report' })
    );
  });

  it('adds a parallel session', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('button', { name: 'Parallel search' }).click();
    await expect.element(page.getByRole('navigation', { name: 'Search sessions' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Search 2', exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: /reportsreports\// }).click();
    expect(goto).toHaveBeenCalledWith('/storage/alpha/reports');

    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).last().click();
    await page.getByLabelText('Search query').last().fill('data');
    await page.getByRole('button', { name: 'Search', exact: true }).last().click();
    await page.getByRole('button', { name: 'data.csv' }).click();
    expect(preview).toHaveBeenCalledWith('preview', { key: 'reports/data.csv', bucket: 'alpha' });
    expect(api.search).toHaveBeenCalled();
  });

  it('records submitted searches to the history as one grouped entry per search', async () => {
    const { state, api } = createState();
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByLabelText('Search query').fill('report');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => api.recordRecentSearch.mock.calls.length).toBe(1);
    expect(api.recordRecentSearch).toHaveBeenCalledWith(
      expect.objectContaining({ buckets: ['alpha', 'beta'], query: 'report' })
    );
  });

  it('shows an empty state for recent searches', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('tab', { name: 'Recent' }).click();
    await expect
      .element(page.getByText('Your recent searches will appear here.'))
      .toBeInTheDocument();
  });

  it('lists recent searches and fills the active session when used', async () => {
    const { state } = createState({
      history: [
        {
          buckets: ['alpha'],
          query: 'report',
          useRegex: true,
          excludePatterns: ['_temp'],
          searchPath: 'events/',
          maxDepth: 2
        }
      ]
    });
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('tab', { name: 'Recent' }).click();
    await page.getByRole('button', { name: /report/ }).click();
    await expect.element(page.getByLabelText('Search query')).toHaveValue('report');
    await expect.element(page.getByRole('button', { name: 'alpha', exact: true })).toBeVisible();
  });

  it('renders grouped multi-bucket history entries without a keyed-each crash', async () => {
    const { state } = createState({
      history: [
        {
          buckets: ['stackable-ui-test'],
          query: 'md',
          useRegex: false,
          excludePatterns: [],
          searchPath: '',
          maxDepth: null
        },
        {
          buckets: ['stackable-ui-test', 'archive'],
          query: 'md',
          useRegex: false,
          excludePatterns: [],
          searchPath: '',
          maxDepth: null
        }
      ]
    });
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('tab', { name: 'Recent' }).click();
    const entries = await page.getByRole('button', { name: /md/ }).elements();
    expect(entries).toHaveLength(2);
  });

  it('selects specific buckets from a grouped recent entry', async () => {
    const { state } = createState({
      history: [
        {
          buckets: ['alpha', 'beta'],
          query: 'report',
          useRegex: false,
          excludePatterns: [],
          searchPath: '',
          maxDepth: null
        }
      ]
    });
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('tab', { name: 'Recent' }).click();
    await page.getByRole('button', { name: 'Choose buckets' }).click();
    await page.getByLabelText('Include beta in this search').click();
    await page.getByRole('button', { name: 'Search selected buckets' }).click();
    await expect.element(page.getByLabelText('Search query')).toHaveValue('report');
    await expect.element(page.getByRole('button', { name: 'beta', exact: true })).toBeVisible();
  });

  it('opens the bucket collapsible instead of searching when a grouped entry row is clicked', async () => {
    const { state, api } = createState({
      history: [
        {
          buckets: ['alpha', 'beta'],
          query: 'report',
          useRegex: false,
          excludePatterns: [],
          searchPath: '',
          maxDepth: null
        }
      ]
    });
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('tab', { name: 'Recent' }).click();
    await page.getByRole('button', { name: /report/ }).click();
    await expect.element(page.getByLabelText('Include beta in this search')).toBeVisible();
    expect(api.search).not.toHaveBeenCalled();
  });

  it('shows tooltips on the bucket chooser and bucket checkboxes in recent entries', async () => {
    const { state } = createState({
      history: [
        {
          buckets: ['alpha', 'beta'],
          query: 'report',
          useRegex: false,
          excludePatterns: [],
          searchPath: '',
          maxDepth: null
        }
      ]
    });
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('tab', { name: 'Recent' }).click();

    await page.getByRole('button', { name: 'Choose buckets' }).hover();
    await expect.element(page.getByRole('tooltip').last()).toHaveTextContent('Choose buckets');

    await page.getByRole('button', { name: 'Choose buckets' }).click();
    await page.getByLabelText('Include alpha in this search').hover();
    await expect.element(page.getByRole('tooltip').last()).toHaveTextContent('alpha');
  });

  it('clears recent searches', async () => {
    const { state, api } = createState({
      history: [
        {
          buckets: ['alpha'],
          query: 'report',
          useRegex: false,
          excludePatterns: [],
          searchPath: '',
          maxDepth: null
        }
      ]
    });
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('tab', { name: 'Recent' }).click();
    await page.getByRole('button', { name: 'Clear recent searches' }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    expect(api.clearRecentSearches).toHaveBeenCalled();
    await expect
      .element(page.getByText('Your recent searches will appear here.'))
      .toBeInTheDocument();
  });
});
