<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { SearchSession, StorageSearchState } from '$lib/storage/search.svelte.js';
  import {
    parseDateFilterValue,
    parseSizeFilterValue,
    type SearchFilter
  } from '$lib/storage/search-filter.js';
  import { createSafeSearchRegex } from '$lib/storage/search-regex.js';
  import BucketSelect from '$lib/components/storage/BucketSelect.svelte';
  import SearchFilterRow from '$lib/components/storage/SearchFilterRow.svelte';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconSearch from 'virtual:icons/material-symbols/search';
  import IconStop from 'virtual:icons/material-symbols/stop';

  interface Props {
    id: string;
    session: SearchSession;
    buckets: string[];
    state: StorageSearchState;
  }

  let { id, session, buckets, state: searchState }: Props = $props();
  let queryCycleTerms: string[] = [];
  let queryCycleIndex = -1;

  function update(patch: Partial<SearchSession>): void {
    searchState.updateSession(session.id, patch);
  }

  function updateFilter(filterId: string, patch: Partial<SearchFilter>): void {
    searchState.updateFilter(filterId, patch);
  }

  function resetQueryCycle(): void {
    queryCycleTerms = [];
    queryCycleIndex = -1;
  }

  function cycleRecentQuery(direction: 1 | -1): void {
    if (queryCycleTerms.length === 0) {
      queryCycleTerms = [
        ...(session.query ? [session.query] : ['']),
        ...searchState.history.map((entry) => entry.query)
      ].filter((query, index, terms) => terms.indexOf(query) === index);
      queryCycleIndex = queryCycleTerms.indexOf(session.query);
    }
    if (queryCycleTerms.length === 0) return;

    const nextIndex = queryCycleIndex + direction;
    if (nextIndex < 0 || nextIndex >= queryCycleTerms.length) return;
    queryCycleIndex = nextIndex;
    update({ query: queryCycleTerms[queryCycleIndex]! });
  }

  const hasInvalidFilter = $derived(
    session.filters.some((filter) => {
      if (filter.value.trim() === '') return false;
      return filter.field === 'date'
        ? parseDateFilterValue(filter) === null
        : parseSizeFilterValue(filter) === null;
    })
  );

  // Firefox accepts non-numeric text in number inputs; valueAsNumber is then NaN.
  let depthBadInput = $state(false);

  // Must match the server's limit in /api/storage/search.
  const depthValid = $derived(
    !depthBadInput &&
      (session.maxDepth === undefined ||
        (Number.isInteger(session.maxDepth) && session.maxDepth >= 1 && session.maxDepth <= 20))
  );

  const regexValid = $derived(
    !session.useRegex || session.query.trim() === '' || isSafeRegex(session.query.trim())
  );

  function isSafeRegex(pattern: string): boolean {
    try {
      createSafeSearchRegex(pattern);
      return true;
    } catch {
      return false;
    }
  }
</script>

<form
  class="flex flex-col gap-4"
  onsubmit={(event) => {
    event.preventDefault();
    if (!depthValid) return;
    void searchState.run(session.id);
  }}
>
  <div class="flex flex-col gap-2 sm:flex-row">
    <div class="input bg-base-100/50 focus-within:border-primary flex flex-1 items-center gap-2">
      <IconSearch class="text-base-content/40 size-4 shrink-0" aria-hidden="true" />
      <label class="sr-only" for="{id}-query">{m.storage_search_query_label()}</label>
      <input
        id="{id}-query"
        class="min-w-0 grow font-mono text-sm"
        type="search"
        value={session.query}
        oninput={(event) => {
          resetQueryCycle();
          update({ query: event.currentTarget.value });
        }}
        onkeydown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          cycleRecentQuery(event.key === 'ArrowDown' ? -1 : 1);
        }}
        placeholder={session.useRegex
          ? m.storage_search_regex_placeholder()
          : m.storage_search_query_placeholder()}
        autocomplete="off"
      />
    </div>
    <button
      type="button"
      class:btn-primary={session.useRegex}
      class="btn"
      aria-pressed={session.useRegex}
      aria-label={m.storage_search_regex_label()}
      title={m.storage_search_regex_label()}
      onclick={() => update({ useRegex: !session.useRegex })}
      >{m.storage_search_regex_badge()}</button
    >
    {#if session.status === 'running'}
      <button type="button" class="btn btn-outline" onclick={() => searchState.cancel(session.id)}
        ><IconStop class="size-4" aria-hidden="true" />{m.storage_search_cancel()}</button
      >
    {:else}
      <button
        type="submit"
        class="btn btn-primary"
        disabled={hasInvalidFilter || !regexValid || !depthValid || !session.query.trim()}
        ><IconSearch class="size-4" aria-hidden="true" />{m.storage_search_submit()}</button
      >
    {/if}
  </div>

  {#if !regexValid}
    <p class="text-error text-xs" role="alert">{m.storage_search_regex_invalid()}</p>
  {/if}

  <div class="flex flex-col gap-3">
    <fieldset class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <legend class="text-muted w-24 shrink-0 text-xs font-medium"
        >{m.storage_search_scope_label()}</legend
      >
      <BucketSelect {session} {buckets} {searchState} />
    </fieldset>
  </div>

  <details
    class="collapse-arrow border-base-300 bg-base-100/30 collapse border"
    open={searchState.advancedOpen}
    ontoggle={(event) => (searchState.advancedOpen = event.currentTarget.open)}
  >
    <summary class="collapse-title text-muted min-h-0 py-2 text-sm font-medium"
      >{m.storage_search_advanced_options()}</summary
    >
    <div class="collapse-content flex flex-col gap-3 pt-1">
      <fieldset>
        <legend class="text-muted mb-1 block text-xs">{m.storage_search_filters_label()}</legend>
        <div class="flex flex-col gap-2">
          {#each session.filters as filter (filter.id)}
            <SearchFilterRow
              {filter}
              onupdate={(patch) => updateFilter(filter.id, patch)}
              onremove={() => searchState.removeFilter(filter.id)}
            />
          {/each}
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs mt-2 gap-1"
          aria-label={m.storage_search_filter_add()}
          onclick={() => searchState.addFilter()}
          ><IconAdd class="size-3.5" aria-hidden="true" />{m.storage_search_filter_add()}</button
        >
      </fieldset>
      <div>
        <label for="{id}-exclude" class="text-muted mb-1 block text-xs"
          >{m.storage_search_exclude_patterns()}</label
        >
        <div class="flex flex-wrap gap-1.5">
          {#each session.excludePatterns as pattern (pattern)}<span
              class="badge badge-error badge-outline badge-sm gap-1 font-mono"
              >{pattern}<button
                type="button"
                aria-label={m.storage_search_remove_exclude({ pattern })}
                onclick={() =>
                  update({
                    excludePatterns: session.excludePatterns.filter((item) => item !== pattern)
                  })}><IconClose class="size-3" aria-hidden="true" /></button
              ></span
            >{/each}<input
            id="{id}-exclude"
            class="input input-xs w-36 border-dashed font-mono"
            value={searchState.excludeInput}
            oninput={(event) => (searchState.excludeInput = event.currentTarget.value)}
            placeholder={m.storage_search_exclude_placeholder()}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                searchState.addExcludePattern();
              }
            }}
          />
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label for="{id}-prefix" class="text-muted mb-1 block text-xs"
            >{m.storage_search_path_prefix()}</label
          ><input
            id="{id}-prefix"
            class="input input-sm w-full font-mono"
            value={session.searchPath}
            oninput={(event) => update({ searchPath: event.currentTarget.value })}
            placeholder={m.storage_search_path_placeholder()}
          />
        </div>
        <div>
          <label for="{id}-depth" class="text-muted mb-1 block text-xs"
            >{m.storage_search_max_depth()}</label
          ><input
            id="{id}-depth"
            class={['input input-sm w-full font-mono', !depthValid && 'input-error']}
            type="number"
            min="1"
            max="20"
            step="1"
            value={session.maxDepth ?? ''}
            oninput={(event) => {
              const value = event.currentTarget.valueAsNumber;
              depthBadInput = event.currentTarget.validity.badInput;
              update({ maxDepth: Number.isNaN(value) ? undefined : value });
            }}
            placeholder={m.storage_search_depth_placeholder()}
            aria-invalid={!depthValid || undefined}
            aria-describedby={depthValid ? undefined : `${id}-depth-error`}
          />
          {#if !depthValid}
            <p id="{id}-depth-error" class="text-error mt-1 text-xs">
              {m.storage_search_max_depth_invalid()}
            </p>
          {/if}
        </div>
      </div>
    </div>
  </details>
</form>
