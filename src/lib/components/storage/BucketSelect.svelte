<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { SearchSession, StorageSearchState } from '$lib/storage/search.svelte.js';
  import IconArrowDropDown from 'virtual:icons/material-symbols/arrow-drop-down';
  import IconArrowDropUp from 'virtual:icons/material-symbols/arrow-drop-up';
  import IconCheck from 'virtual:icons/material-symbols/check';
  import IconSearch from 'virtual:icons/material-symbols/search';

  interface Props {
    session: SearchSession;
    buckets: string[];
    searchState: StorageSearchState;
  }

  let { session, buckets, searchState }: Props = $props();

  const uid = $props.id();
  const popoverId = `${uid}-bucket-scope`;
  const anchorName = `--bucket-select-${uid}`;

  let popoverEl = $state<HTMLDivElement>();
  let open = $state(false);
  let filter = $state('');
  let filterInput = $state<HTMLInputElement>();

  const selectedCount = $derived(session.selectedBuckets.length);
  const selectedSummary = $derived(session.selectedBuckets.join(', '));
  const FIRST_BUCKETS_IN_SUMMARY = 2;
  const selectedLabel = $derived(
    selectedCount === 0
      ? ''
      : selectedCount > FIRST_BUCKETS_IN_SUMMARY
        ? `${session.selectedBuckets
            .slice(0, FIRST_BUCKETS_IN_SUMMARY)
            .join(', ')}, ${m.storage_search_scope_more({
            count: selectedCount - FIRST_BUCKETS_IN_SUMMARY
          })}`
        : selectedSummary
  );
  const filteredBuckets = $derived(
    buckets.filter((bucket) => bucket.toLowerCase().includes(filter.trim().toLowerCase()))
  );

  function toggle(bucket: string): void {
    searchState.toggleBucket(bucket);
  }

  function selectAll(): void {
    searchState.setBucketScope([]);
  }

  function onToggle(event: Event): void {
    const newState = (event as Event & { newState: 'open' | 'closed' }).newState;
    open = newState === 'open';
    if (newState === 'open') {
      filterInput?.focus();
    } else {
      filter = '';
    }
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      popoverEl?.showPopover();
    }
  }

  function handleFilterKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') event.preventDefault();
    if (event.key === 'Escape') {
      event.preventDefault();
      popoverEl?.hidePopover();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      (
        document.getElementById(popoverId)?.querySelector('ul button') as HTMLButtonElement | null
      )?.focus();
    }
  }
</script>

<div class="relative flex-1">
  <button
    type="button"
    class="input focus:border-primary cursor-pointer gap-2 pe-2 text-left font-normal"
    popovertarget={popoverId}
    style={`anchor-name:${anchorName}`}
    aria-expanded={open}
    aria-controls={popoverId}
    title={selectedCount === 0 ? m.storage_search_all_buckets() : selectedSummary}
    onkeydown={handleTriggerKeydown}
  >
    {#if selectedCount === 0}
      <span class="text-base-content/50 min-w-0 flex-1 truncate italic">
        {m.storage_search_all_buckets()}
      </span>
    {:else}
      <span class="min-w-0 flex-1 truncate">{selectedLabel}</span>
    {/if}
    {#if open}
      <IconArrowDropUp
        class="text-base-content/60 pointer-events-none size-5 shrink-0"
        aria-hidden="true"
      />
    {:else}
      <IconArrowDropDown
        class="text-base-content/60 pointer-events-none size-5 shrink-0"
        aria-hidden="true"
      />
    {/if}
  </button>

  <div
    class="dropdown dropdown-end bg-base-100 w-72 rounded shadow-lg"
    popover
    bind:this={popoverEl}
    id={popoverId}
    style={`position-anchor:${anchorName};width:anchor-size(${anchorName} width)`}
    ontoggle={onToggle}
  >
    <div class="p-1.5 pb-0">
      <div class="input bg-base-100/50 focus-within:border-primary flex items-center gap-2">
        <IconSearch class="text-base-content/40 size-4 shrink-0" aria-hidden="true" />
        <label class="sr-only" for="{uid}-bucket-filter"
          >{m.storage_search_scope_filter_label()}</label
        >
        <input
          id="{uid}-bucket-filter"
          bind:this={filterInput}
          class="min-w-0 grow text-sm"
          type="search"
          placeholder={m.storage_search_scope_filter_placeholder()}
          autocomplete="off"
          bind:value={filter}
          onkeydown={handleFilterKeydown}
        />
      </div>
    </div>
    <ul class="menu max-h-64 w-full flex-nowrap overflow-y-auto p-1">
      <li>
        <button
          type="button"
          class={selectedCount === 0 ? 'bg-primary/10 text-primary font-medium' : ''}
          aria-pressed={selectedCount === 0}
          aria-label={m.storage_search_scope_all()}
          onclick={selectAll}
        >
          <IconCheck
            class={selectedCount === 0 ? 'size-4' : 'invisible size-4'}
            aria-hidden="true"
          />
          <span>{m.storage_search_scope_all()}</span>
        </button>
      </li>
      <li class="pointer-events-none" role="presentation">
        <hr class="border-base-300 my-1" aria-hidden="true" />
      </li>
      {#if filteredBuckets.length === 0}
        <li>
          <span class="text-base-content/40 pointer-events-none block px-3 py-2 text-sm italic"
            >{m.storage_search_scope_no_results()}</span
          >
        </li>
      {:else}
        {#each filteredBuckets as bucket (bucket)}
          {@const selected = session.selectedBuckets.includes(bucket)}
          <li>
            <button
              type="button"
              class={selected ? 'bg-primary/10 text-primary font-medium' : ''}
              aria-pressed={selected}
              aria-label={m.storage_search_scope_toggle({ bucket })}
              onclick={() => toggle(bucket)}
            >
              <IconCheck class={selected ? 'size-4' : 'invisible size-4'} aria-hidden="true" />
              <span class="font-mono">{bucket}</span>
            </button>
          </li>
        {/each}
      {/if}
    </ul>
  </div>
</div>
