<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { SearchSession, StorageSearchState } from '$lib/storage/search.svelte.js';
  import BucketSelect from '$lib/components/storage/BucketSelect.svelte';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconSearch from 'virtual:icons/material-symbols/search';

  interface Props {
    id: string;
    session: SearchSession;
    buckets: string[];
    state: StorageSearchState;
  }

  let { id, session, buckets, state }: Props = $props();

  function update(patch: Partial<SearchSession>): void {
    state.updateSession(session.id, patch);
  }
</script>

<form
  class="flex flex-col gap-4"
  onsubmit={(event) => {
    event.preventDefault();
    void state.run(session.id);
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
        oninput={(event) => update({ query: event.currentTarget.value })}
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
      title={m.storage_search_regex_label()}
      onclick={() => update({ useRegex: !session.useRegex })}
      >{m.storage_search_regex_badge()}</button
    >
    <button
      type="submit"
      class="btn btn-primary"
      disabled={session.status === 'running' || !session.query.trim()}
      >{#if session.status === 'running'}<span
          class="loading loading-spinner loading-sm"
          aria-hidden="true"
        ></span>{:else}<IconSearch
          class="size-4"
          aria-hidden="true"
        />{/if}{m.storage_search_submit()}</button
    >
  </div>

  <div class="flex flex-col gap-3">
    <fieldset class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <legend class="text-base-content/60 w-24 shrink-0 text-xs font-medium"
        >{m.storage_search_scope_label()}</legend
      >
      <BucketSelect {session} {buckets} searchState={state} />
    </fieldset>
  </div>

  <details
    class="collapse-arrow border-base-300 bg-base-100/30 collapse border"
    open={state.advancedOpen}
    ontoggle={(event) => (state.advancedOpen = event.currentTarget.open)}
  >
    <summary class="collapse-title text-base-content/60 min-h-0 py-2 text-sm font-medium"
      >{m.storage_search_advanced_options()}</summary
    >
    <div class="collapse-content flex flex-col gap-3 pt-1">
      <div>
        <label for="{id}-exclude" class="text-base-content/60 mb-1 block text-xs"
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
            value={state.excludeInput}
            oninput={(event) => (state.excludeInput = event.currentTarget.value)}
            placeholder={m.storage_search_exclude_placeholder()}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                state.addExcludePattern();
              }
            }}
            onblur={() => state.excludeInput.trim() && state.addExcludePattern()}
          />
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label for="{id}-prefix" class="text-base-content/60 mb-1 block text-xs"
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
          <label for="{id}-depth" class="text-base-content/60 mb-1 block text-xs"
            >{m.storage_search_max_depth()}</label
          ><input
            id="{id}-depth"
            class="input input-sm w-full font-mono"
            type="number"
            min="0"
            max="20"
            value={session.maxDepth ?? ''}
            oninput={(event) => {
              const input = event.currentTarget;
              const maxDepth = input.valueAsNumber > 0 ? input.valueAsNumber : undefined;
              input.value = maxDepth === undefined ? '' : String(maxDepth);
              update({ maxDepth });
            }}
            placeholder={m.storage_search_depth_placeholder()}
          />
        </div>
      </div>
    </div>
  </details>
</form>
