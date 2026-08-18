import { SvelteMap } from 'svelte/reactivity';
import * as m from '$lib/paraglide/messages.js';
import {
  isUsableFilter,
  type SearchFilter,
  type SearchFilterField
} from '$lib/storage/search-filter.js';
import type { StorageApi } from '$lib/storage/api.js';
import type { SearchResultItem } from '$lib/storage/types.js';

export type SearchStatus = 'idle' | 'running' | 'done' | 'error';

export interface SearchResult extends SearchResultItem {
  bucket: string;
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
  truncated: boolean;
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
  active = $derived(this.sessions.find((session) => session.id === this.activeId));
  runningCount = $derived(this.sessions.filter((session) => session.status === 'running').length);
  completedCount = $derived(this.sessions.filter((session) => session.status === 'done').length);

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
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  addSession(): void {
    this.sessionCounter += 1;
    const id = `s${Date.now()}`;
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
      const session = this.makeSession(`s${Date.now()}`, this.sessionCounter);
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
    if (!session) return;

    this.controllers.get(id)?.abort();
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.updateSession(id, { status: 'running', results: [], elapsed: 0, truncated: false });
    const started = performance.now();
    this.started.set(id, started);
    const buckets =
      session.selectedBuckets.length > 0 ? session.selectedBuckets : this.getBuckets();

    try {
      const responses = await Promise.all(
        buckets.map((bucket) =>
          this.api
            .search({
              bucket,
              query: session.query.trim(),
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
                if (controller.signal.aborted) return;
                const otherResults =
                  this.sessions
                    .find((item) => item.id === id)
                    ?.results.filter((result) => result.bucket !== bucket) ?? [];
                this.updateSession(id, {
                  results: [
                    ...otherResults,
                    ...update.results.map((result) => ({ ...result, bucket }))
                  ],
                  truncated: update.truncated
                });
              }
            })
            .then((response) => ({ bucket, ...response }))
        )
      );
      if (controller.signal.aborted) return;
      const results = responses.flatMap(({ bucket, results }) =>
        results.map((result) => ({ ...result, bucket }))
      );
      this.updateSession(id, {
        status: 'done',
        results,
        elapsed: Math.round(performance.now() - started),
        truncated: responses.some((response) => response.truncated)
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.updateSession(id, {
          status: 'error',
          elapsed: Math.round(performance.now() - started)
        });
      }
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
      this.started.delete(id);
    }
  }

  /**
   * Abort a running search. Partial results (if any) are kept visible and the
   * session is marked done; a session that produced no results returns to idle.
   */
  cancel(id: string): void {
    const session = this.sessions.find((item) => item.id === id);
    if (!session || session.status !== 'running') return;
    this.controllers.get(id)?.abort();
    const startedAt = this.started.get(id);
    const elapsed = startedAt === undefined ? 0 : Math.round(performance.now() - startedAt);
    this.updateSession(id, {
      status: session.results.length > 0 ? 'done' : 'idle',
      elapsed
    });
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
      truncated: false
    };
  }
}
