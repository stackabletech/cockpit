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
    await expect.element(page.getByRole('button', { name: 'alpha', exact: true })).toBeVisible();
  });

  it('focuses the query input when the modal opens', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state });
    await page.getByRole('button', { name: 'Open search' }).click();
    await expect.element(page.getByLabelText('Search query')).toHaveFocus();
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

  it('sends regex and exclusion filters to the backend', async () => {
    const { state, api } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('button', { name: '.*', exact: true }).click();
    await expect
      .element(page.getByRole('button', { name: '.*', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await page.getByText('Advanced options').click();
    await page.getByLabelText('Exclude patterns').fill('archive');
    await page.getByLabelText('Search query').click();
    await page.getByLabelText('Search query').fill('report.*');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => api.search.mock.calls.length).toBe(1);
    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({ useRegex: true, excludePatterns: ['archive'] })
    );
  });

  it('clears the maximum depth when set to zero so the search stays unlimited', async () => {
    const { state, api } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByText('Advanced options').click();
    const depth = page.getByLabelText('Max folder depth');
    await depth.fill('1');
    await depth.fill('0');
    await expect.element(depth).toHaveProperty('value', '');
    await page.getByLabelText('Search query').fill('report');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => api.search.mock.calls.length).toBe(1);
    expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ maxDepth: undefined }));
  });

  it('does not leave zero in the depth field when entered from the unlimited state', async () => {
    const { state, api } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByText('Advanced options').click();
    const depth = page.getByLabelText('Max folder depth');
    await depth.fill('0');
    await expect.element(depth).toHaveProperty('value', '');
    await page.getByLabelText('Search query').fill('report');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => api.search.mock.calls.length).toBe(1);
    expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ maxDepth: undefined }));
  });

  it('adds a parallel session', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('button', { name: 'Parallel search' }).click();
    await expect.element(page.getByRole('navigation', { name: 'Search sessions' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Search 2', exact: true })).toBeVisible();
  });

  it('sends date and size filters to the backend', async () => {
    const { state, api } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByText('Advanced options').click();
    await page.getByLabelText('Size value').fill('10');
    await page.getByLabelText('Date value').fill('15.03.2027');
    await page.getByLabelText('Search query').fill('report');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => api.search.mock.calls.length).toBe(1);
    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          { field: 'date', operator: '>', value: '15.03.2027' },
          { field: 'size', operator: '>', value: '10' }
        ]
      })
    );
  });

  it('adds and removes filter rows', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByText('Advanced options').click();
    await expect.poll(() => page.getByLabelText('Filter field').elements().length).toBe(2);
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect.poll(() => page.getByLabelText('Filter field').elements().length).toBe(3);
    await page.getByLabelText('Filter field').last().selectOptions('size');
    await page.getByRole('button', { name: 'Remove filter' }).last().click();
    await expect.poll(() => page.getByLabelText('Filter field').elements().length).toBe(2);
  });

  it('disables search while a filter value is invalid', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByText('Advanced options').click();
    await page.getByLabelText('Search query').fill('report');
    const search = page.getByRole('button', { name: 'Search', exact: true });
    await expect.element(search).toBeEnabled();
    await page.getByLabelText('Size value').fill('not-a-size');
    await expect.element(search).toBeDisabled();
  });

  it('replaces the submit button with Cancel while a search is running', async () => {
    // A search that never settles keeps the session in the running state.
    const pending = new StorageState({
      connected: true,
      buckets: ['alpha', 'beta'],
      api: {
        search: vi.fn().mockReturnValue(new Promise(() => {}))
      } as unknown as StorageApi
    });
    render(StorageSearchWrapper, { state: pending, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByLabelText('Search query').fill('report');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    const search = page.getByRole('button', { name: 'Search', exact: true });
    await expect.element(cancel).toBeVisible();
    await expect.poll(() => search.elements().length).toBe(0);
    await cancel.click();
    await expect.element(search).toBeVisible();
    await expect.poll(() => cancel.elements().length).toBe(0);
  });

  it('blocks unsafe regular expressions from running', async () => {
    const { state, api } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('button', { name: '.*', exact: true }).click();
    const search = page.getByRole('button', { name: 'Search', exact: true });
    await page.getByLabelText('Search query').fill('(a+)+');
    await expect.element(search).toBeDisabled();
    await expect.element(page.getByText(/unsupported constructs/)).toBeVisible();
    await page.getByLabelText('Search query').fill('report-[0-9]+');
    await expect.element(search).toBeEnabled();
    await expect.poll(() => page.getByText(/unsupported constructs/).elements().length).toBe(0);
    await search.click();
    await expect.poll(() => api.search.mock.calls.length).toBe(1);
  });

  it('opens the date picker at a valid typed date and writes the picked date back', async () => {
    const { state } = createState();
    render(StorageSearchWrapper, { state, currentBucket: 'alpha' });
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByText('Advanced options').click();
    await page.getByLabelText('Date value').fill('15.03.2027');
    await page.getByRole('button', { name: 'Pick a date' }).click();
    const picker = page.getByRole('dialog', { name: 'Date picker' });
    await expect.element(picker).toBeVisible();
    await expect.element(picker).toHaveTextContent('March 2027');
    await picker.getByRole('button', { name: /Select March 20, 2027/ }).click();
    await expect.element(page.getByLabelText('Date value')).toHaveProperty('value', '2027-03-20');
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
