import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StorageSearchWrapper from './StorageSearchWrapper.svelte';
import { StorageState } from '$lib/storage/state.svelte.js';
import type { StorageApi } from '$lib/storage/api.js';
import type { StorageSearchResponse } from '$lib/storage/types.js';

const { goto, invalidateAll } = vi.hoisted(() => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto, invalidateAll }));
vi.mock('$app/paths', () => ({
  resolve: (_route: string, params: { bucket: string; prefix: string }) =>
    `/storage/${params.bucket}/${params.prefix}`
}));

type SearchApiMock = {
  search: ReturnType<typeof vi.fn>;
};

function createState(options?: { response?: StorageSearchResponse }): {
  state: StorageState;
  api: SearchApiMock;
} {
  const api = {
    search: vi.fn().mockResolvedValue(options?.response ?? { results: [], truncated: false })
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
    await expect
      .element(page.getByRole('button', { name: 'alpha', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
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
});
