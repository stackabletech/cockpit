<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import TooltipTrigger from '$lib/components/TooltipTrigger.svelte';
  import type { RecentSearchEntry } from '$lib/storage/types.js';
  import IconExpandLess from 'virtual:icons/material-symbols/expand-less';
  import IconExpandMore from 'virtual:icons/material-symbols/expand-more';
  import IconSearch from 'virtual:icons/material-symbols/search';

  interface Props {
    entry: RecentSearchEntry;
    onUse: (entry: RecentSearchEntry, buckets: string[]) => void;
  }

  let { entry, onUse }: Props = $props();

  const uid = $props.id();

  const MAX_SUMMARY_BUCKETS = 3;

  let expanded = $state(false);
  let selected = $state<string[]>([]);

  const multipleBuckets = $derived(entry.buckets.length > 1);
  const allSelected = $derived(selected.length === entry.buckets.length);
  const summary = $derived.by(() => {
    if (entry.searchPath) return entry.searchPath;
    const shown = entry.buckets.slice(0, MAX_SUMMARY_BUCKETS);
    const remaining = entry.buckets.length - shown.length;
    return remaining > 0
      ? `${shown.join(', ')}, ${m.storage_search_recent_more_buckets({ count: remaining })}`
      : shown.join(', ');
  });

  function toggleBucket(bucket: string): void {
    selected = selected.includes(bucket)
      ? selected.filter((item) => item !== bucket)
      : [...selected, bucket];
  }

  function toggleAll(): void {
    selected = allSelected ? [] : [...entry.buckets];
  }

  function use(): void {
    if (selected.length === 0) return;
    onUse(entry, selected);
  }

  function useAll(): void {
    onUse(entry, entry.buckets);
  }

  function toggleExpanded(): void {
    expanded = !expanded;
  }

  function handleRowClick(): void {
    if (multipleBuckets) {
      toggleExpanded();
    } else {
      useAll();
    }
  }
</script>

<div class="border-base-300 bg-base-100/30 hover:bg-base-100 rounded border transition-colors">
  <div class="flex items-center gap-1">
    <button
      type="button"
      class="min-w-0 flex-1 cursor-pointer items-center gap-2 rounded ps-2 text-start"
      disabled={entry.buckets.length === 0}
      aria-expanded={multipleBuckets ? expanded : undefined}
      aria-controls={multipleBuckets ? `${uid}-buckets` : undefined}
      onclick={handleRowClick}
    >
      <span class="flex min-w-0 items-center gap-2 py-2">
        <IconSearch class="size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-mono text-sm">{entry.query}</span>
          <span class="text-base-content/50 block truncate font-mono text-xs">{summary}</span>
        </span>
        {#if multipleBuckets}
          <span class="badge badge-outline badge-sm shrink-0 font-mono"
            >{m.storage_search_recent_bucket_count({ count: entry.buckets.length })}</span
          >
        {:else}
          <span class="badge badge-outline badge-sm mr-2 shrink-0 font-mono"
            >{entry.buckets[0]}</span
          >
        {/if}
      </span>
    </button>
    {#if multipleBuckets}
      <TooltipTrigger text={m.storage_search_recent_toggle_buckets()} orientation="up">
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square mr-2 shrink-0"
          aria-expanded={expanded}
          aria-controls="{uid}-buckets"
          aria-label={m.storage_search_recent_toggle_buckets()}
          onclick={toggleExpanded}
        >
          {#if expanded}
            <IconExpandLess class="size-4" aria-hidden="true" />
          {:else}
            <IconExpandMore class="size-4" aria-hidden="true" />
          {/if}
        </button>
      </TooltipTrigger>
    {/if}
  </div>
  {#if multipleBuckets && expanded}
    <div
      id="{uid}-buckets"
      class="border-base-300 bg-base-100/40 flex flex-col gap-2 border-t px-3 py-2"
    >
      <label
        class="label cursor-pointer justify-start gap-2 py-1"
        for="{uid}-all"
        aria-label={m.storage_search_recent_bucket_all()}
      >
        <input
          id="{uid}-all"
          type="checkbox"
          class="checkbox checkbox-primary checkbox-xs"
          checked={allSelected}
          onchange={toggleAll}
        />
        <span class="text-xs font-medium">{m.storage_search_recent_bucket_all()}</span>
      </label>
      <ul class="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
        {#each entry.buckets as bucket (bucket)}
          {@const checked = selected.includes(bucket)}
          <li class="min-w-0">
            <TooltipTrigger text={bucket} orientation="up">
              <label
                class="label flex min-w-0 cursor-pointer justify-start gap-2 py-1"
                for="{uid}-{bucket}"
                aria-label={m.storage_search_recent_bucket_toggle({ bucket })}
              >
                <input
                  id="{uid}-{bucket}"
                  type="checkbox"
                  class="checkbox checkbox-primary checkbox-xs shrink-0"
                  {checked}
                  onchange={() => toggleBucket(bucket)}
                />
                <span class="min-w-0 truncate font-mono text-xs">{bucket}</span>
              </label>
            </TooltipTrigger>
          </li>
        {/each}
      </ul>
      <button
        type="button"
        class="btn btn-primary btn-xs mt-1 gap-1 self-start"
        disabled={selected.length === 0}
        onclick={use}
      >
        <IconSearch class="size-3.5" aria-hidden="true" />
        {m.storage_search_recent_use_selected()}
      </button>
    </div>
  {/if}
</div>
