import { SvelteMap } from 'svelte/reactivity';
import * as m from '$lib/paraglide/messages.js';
import {
  isUsableFilter,
  type SearchFilter,
  type SearchFilterField
} from '$lib/storage/search-filter.js';
import type { StorageApi } from '$lib/storage/api.js';
import { StorageError } from '$lib/storage/errors.js';
import type { RecentSearchEntry, SearchResultItem } from '$lib/storage/types.js';

export type SearchStatus = 'idle' | 'running' | 'done' | 'error';

export interface SearchResult extends SearchResultItem {
  bucket: string;
}

export interface SearchFailure {
  code: string;
}

export interface SearchSession {
  id: string;
  label: string;
  query: string;
  selectedBuckets: string[];
  useRegex: boolean;
  excludePatterns: string[];
  searchPath: string;
  maxDepth: number | undefined;
  filters: SearchFilter[];
  results: SearchResult[];
  status: SearchStatus;
  elapsed: number;
  failures: SearchFailure[];
}

export class StorageSearchState {
  private sessionCounter = 1;
  private filterCounter = 0;
  private controllers = new SvelteMap<string, AbortController>();
  private started = new SvelteMap<string, number>();
  private readonly api: StorageApi;
  private readonly getBuckets: () => string[];
  private readonly getCurrentBucket: () => string | undefined;

  sessions = $state<SearchSession[]>([]);
  activeId = $state('s1');
  excludeInput = $state('');
  advancedOpen = $state(false);
  history = $state<RecentSearchEntry[]>([]);
  active = $derived(this.sessions.find((session) => session.id === this.activeId));
  runningCount = $derived(this.sessions.filter((session) => session.status === 'running').length);
  completedCount = $derived(this.sessions.filter((session) => session.status === 'done').length);
  partialCount = $derived(
    this.sessions.filter((session) => session.status === 'done' && session.failures.length > 0)
      .length
  );

  constructor(options: {
    api: StorageApi;
    getBuckets: () => string[];
    getCurrentBucket: () => string | undefined;
  }) {
    this.api = options.api;
    this.getBuckets = options.getBuckets;
    this.getCurrentBucket = options.getCurrentBucket;
    this.sessions = [this.makeSession('s1', this.sessionCounter)];
  }

  close(): void {
    for (const id of this.controllers.keys()) this.cancel(id);
    this.controllers.clear();
    this.started.clear();
  }

  async open(): Promise<void> {
    this.history = await this.loadHistory();
  }

  private async loadHistory(): Promise<RecentSearchEntry[]> {
    try {
      return await this.api.listRecentSearches();
    } catch {
      return [];
    }
  }

  async refreshHistory(): Promise<void> {
    this.history = await this.loadHistory();
  }

  async clearHistory(): Promise<void> {
    try {
      await this.api.clearRecentSearches();
      this.history = [];
    } catch {
      // Clearing history is non-essential; the list simply stays as is.
    }
  }

  useRecentEntry(entry: RecentSearchEntry, buckets?: string[]): void {
    const active = this.active;
    if (!active) return;
    this.cancel(active.id);
    this.updateSession(active.id, {
      query: entry.query,
      selectedBuckets: buckets && buckets.length > 0 ? buckets : entry.buckets,
      useRegex: entry.useRegex,
      excludePatterns: entry.excludePatterns,
      searchPath: entry.searchPath,
      maxDepth: entry.maxDepth ?? undefined,
      filters: [],
      results: [],
      status: 'idle',
      elapsed: 0,
      failures: []
    });
  }

  addSession(): void {
    if (this.sessions.length >= 8) return;
    this.sessionCounter += 1;
    const id = `s${this.sessionCounter}`;
    this.sessions = [...this.sessions, this.makeSession(id, this.sessionCounter)];
    this.activeId = id;
    this.excludeInput = '';
    this.advancedOpen = false;
  }

  removeSession(id: string): void {
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    const remaining = this.sessions.filter((session) => session.id !== id);
    if (remaining.length === 0) {
      this.sessionCounter += 1;
      const session = this.makeSession(`s${this.sessionCounter}`, this.sessionCounter);
      this.sessions = [session];
      this.activeId = session.id;
      return;
    }
    this.sessions = remaining;
    if (this.activeId === id) this.activeId = remaining.at(-1)!.id;
  }

  addExcludePattern(): void {
    const active = this.active;
    if (!active) return;
    const pattern = this.excludeInput.trim();
    if (pattern && !active.excludePatterns.includes(pattern)) {
      this.updateSession(active.id, { excludePatterns: [...active.excludePatterns, pattern] });
    }
    this.excludeInput = '';
  }

  toggleBucket(bucket: string): void {
    const active = this.active;
    if (!active) return;
    this.updateSession(active.id, {
      selectedBuckets: active.selectedBuckets.includes(bucket)
        ? active.selectedBuckets.filter((item) => item !== bucket)
        : [...active.selectedBuckets, bucket]
    });
  }

  setBucketScope(buckets: string[]): void {
    const active = this.active;
    if (!active) return;
    this.updateSession(active.id, { selectedBuckets: buckets });
  }

  private newFilterId(): string {
    this.filterCounter += 1;
    return `f${this.filterCounter}`;
  }

  addFilter(field: SearchFilterField = 'date'): void {
    const active = this.active;
    if (!active) return;
    this.updateSession(active.id, {
      filters: [...active.filters, { id: this.newFilterId(), field, operator: '>', value: '' }]
    });
  }

  removeFilter(id: string): void {
    const active = this.active;
    if (!active) return;
    this.updateSession(active.id, {
      filters: active.filters.filter((filter) => filter.id !== id)
    });
  }

  updateFilter(id: string, patch: Partial<SearchFilter>): void {
    const active = this.active;
    if (!active) return;
    this.updateSession(active.id, {
      filters: active.filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter))
    });
  }

  updateSession(id: string, patch: Partial<SearchSession>): void {
    this.sessions = this.sessions.map((session) =>
      session.id === id ? { ...session, ...patch } : session
    );
  }

  async run(id: string): Promise<void> {
    const session = this.sessions.find((item) => item.id === id);
    if (!session || !session.query.trim()) return;

    const buckets =
      session.selectedBuckets.length > 0 ? session.selectedBuckets : this.getBuckets();
    if (buckets.length === 0) {
      this.updateSession(id, { status: 'done', results: [], failures: [], elapsed: 0 });
      return;
    }

    // Record the submitted search in the per-connection history as a single
    // grouped entry covering all searched buckets. Fire-and-forget: history is
    // non-essential, so failures are swallowed and the list is refreshed once
    // the record has settled.
    const trimmedQuery = session.query.trim();
    const recordPromise = this.api
      .recordRecentSearch({
        buckets,
        query: trimmedQuery,
        useRegex: session.useRegex,
        excludePatterns: session.excludePatterns,
        searchPath: session.searchPath,
        maxDepth: session.maxDepth
      })
      .catch(() => undefined);
    void Promise.allSettled([recordPromise]).then(() => this.refreshHistory());

    this.controllers.get(id)?.abort();
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.updateSession(id, {
      status: 'running',
      results: [],
      elapsed: 0,
      failures: []
    });
    const started = performance.now();
    this.started.set(id, started);

    try {
      const responses: PromiseSettledResult<{ bucket: string; results: SearchResultItem[] }>[] = [];
      let nextBucket = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, buckets.length) }, async () => {
          while (nextBucket < buckets.length && !controller.signal.aborted) {
            const bucket = buckets[nextBucket++];
            const [response] = await Promise.allSettled([
              this.api
                .search({
                  bucket,
                  query: trimmedQuery,
                  prefix: session.searchPath,
                  maxDepth: session.maxDepth,
                  useRegex: session.useRegex,
                  excludePatterns: session.excludePatterns,
                  filters: session.filters
                    .filter((filter) => filter.value.trim() !== '')
                    .filter(isUsableFilter)
                    .map(({ field, operator, value }) => ({ field, operator, value })),
                  signal: controller.signal,
                  onUpdate: (update) => {
                    if (this.controllers.get(id) !== controller || controller.signal.aborted)
                      return;
                    const results = update.results.map((result) => ({ ...result, bucket }));
                    const current = this.sessions.find((item) => item.id === id);
                    if (!current) return;
                    this.updateSession(id, {
                      results: [
                        ...(update.snapshot
                          ? current.results.filter((result) => result.bucket !== bucket)
                          : current.results),
                        ...results
                      ].slice(0, 10_000)
                    });
                  }
                })
                .then((response) => ({ bucket, ...response }))
            ]);
            responses.push(response);
          }
        })
      );
      if (controller.signal.aborted || this.controllers.get(id) !== controller) return;
      const successfulResponses = responses
        .filter((response) => response.status === 'fulfilled')
        .map((response) => response.value);
      const failures: SearchFailure[] = responses.flatMap((response) => {
        if (response.status !== 'rejected') return [];
        return [
          { code: response.reason instanceof StorageError ? response.reason.code : 'unknown' }
        ];
      });
      const current = this.sessions.find((item) => item.id === id);
      if (!current) return;
      const results = successfulResponses.reduce(
        (accumulated, { bucket, results }) => [
          ...accumulated.filter((result) => result.bucket !== bucket),
          ...results.map((result) => ({ ...result, bucket }))
        ],
        current.results
      );
      this.updateSession(id, {
        status: successfulResponses.length > 0 ? 'done' : 'error',
        results: results.slice(0, 10_000),
        elapsed: Math.round(performance.now() - started),
        failures
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.updateSession(id, {
          status: 'error',
          elapsed: Math.round(performance.now() - started)
        });
      }
    } finally {
      if (this.controllers.get(id) === controller) {
        this.controllers.delete(id);
        this.started.delete(id);
      }
    }
  }

  cancel(id: string): void {
    const session = this.sessions.find((item) => item.id === id);
    if (!session || session.status !== 'running') return;
    this.controllers.get(id)?.abort();
    const startedAt = this.started.get(id);
    const elapsed = startedAt === undefined ? 0 : Math.round(performance.now() - startedAt);
    this.updateSession(id, { status: session.results.length > 0 ? 'done' : 'idle', elapsed });
  }

  private makeSession(id: string, number: number): SearchSession {
    return {
      id,
      label: m.storage_search_session_label({ number }),
      query: '',
      selectedBuckets: this.getCurrentBucket() ? [this.getCurrentBucket()!] : [],
      useRegex: false,
      excludePatterns: [],
      searchPath: '',
      maxDepth: undefined,
      filters: [
        { id: this.newFilterId(), field: 'date', operator: '>', value: '' },
        { id: this.newFilterId(), field: 'size', operator: '>', value: '' }
      ],
      results: [],
      status: 'idle',
      elapsed: 0,
      failures: []
    };
  }
}
