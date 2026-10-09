<script lang="ts">
  import IconFirstPage from 'virtual:icons/material-symbols/first-page';
  import IconChevronLeft from 'virtual:icons/material-symbols/chevron-left';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import IconLastPage from 'virtual:icons/material-symbols/last-page';
  import * as m from '$lib/paraglide/messages.js';
  import { browser } from '$app/environment';
  import { isPageSize, type PageSize } from '$lib/types/pagination.js';
  import { allowedPageSizes } from '$lib/client/feature-flags.js';

  interface Props {
    /** Bound page size — parent initialises this from `initPageSize()`. */
    pageSize: PageSize;
    /** localStorage key used to persist the selected page size. */
    storageKey: string;
    /** Translated label shown next to the page-size selector. */
    pageSizeLabel: string;
    /**
     * Optional info text rendered beside the navigation buttons.
     * E.g. "Page 3" (storage) or "Rows 1–25 of 100" (trino).
     */
    infoLabel?: string;
    /** 0-based current page index. The component derives first/prev states from this. */
    current: number;
    /**
     * Total number of pages, if known. Drives next/last button states and renders a Last button.
     * When omitted (e.g. S3 cursor pagination where total pages are unknown), provide `hasNext`.
     */
    total?: number;
    /**
     * Whether the next page exists. Only used when `total` is not provided (cursor-based
     * pagination where the total page count is unknown from the API).
     */
    hasNext?: boolean;
    onfirst: () => void;
    onprev: () => void;
    onnext: () => void;
    /** Called when navigating to the last page. Only relevant when `total` is provided. */
    onlast?: () => void;
    /** Called after the page size changes so the parent can reset page state. */
    onpagesizechange?: () => void;
    /**
     * Layout variant.
     * - `false` (default): page-size selector on the left, info + buttons on the right.
     * - `true`: nav buttons + info on the left, page-size selector on the right.
     */
    pageSizeRight?: boolean;
  }

  let {
    pageSize = $bindable(),
    storageKey,
    pageSizeLabel,
    infoLabel,
    current,
    total,
    hasNext,
    onfirst,
    onprev,
    onnext,
    onlast,
    onpagesizechange,
    pageSizeRight = false
  }: Props = $props();

  const uid = $props.id();

  const canGoFirst = $derived(current > 0);
  const canGoPrev = $derived(current > 0);
  const canGoNext = $derived(total !== undefined ? current < total - 1 : (hasNext ?? false));
  const canGoLast = $derived(total !== undefined && current < total - 1);
  const showLast = $derived(total !== undefined && onlast !== undefined);
  const showNavButtons = $derived(canGoFirst || canGoNext || showLast);

  function handlePageSizeChange(event: Event) {
    const n = parseInt((event.target as HTMLSelectElement).value, 10);
    if (isPageSize(n)) {
      pageSize = n;
      if (browser) localStorage.setItem(storageKey, String(n));
      onpagesizechange?.();
    }
  }
</script>

{#snippet pageSizeSelector()}
  <div class="flex items-center gap-2">
    <label for="{uid}-page-size" class="text-base-content/60 text-xs whitespace-nowrap">
      {pageSizeLabel}
    </label>
    <select
      id="{uid}-page-size"
      class="select select-xs w-14 px-1"
      value={pageSize}
      onchange={handlePageSizeChange}
    >
      {#each allowedPageSizes as size (size)}
        <option value={size}>{size}</option>
      {/each}
    </select>
  </div>
{/snippet}

{#if pageSizeRight}
  <!-- Trino layout: nav + info on left, page-size selector on right -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      {#if showNavButtons}
        <nav class="flex items-center" aria-label={m.pagination_nav()}>
          <div class="tooltip tooltip-top" data-tip={m.pagination_first_page()}>
            <button
              class="btn btn-ghost btn-xs"
              onclick={onfirst}
              disabled={!canGoFirst}
              aria-label={m.pagination_first_page()}
            >
              <IconFirstPage class="size-4 {canGoFirst ? '' : 'opacity-40'}" aria-hidden="true" />
            </button>
          </div>
          <div class="tooltip tooltip-top" data-tip={m.pagination_prev_page()}>
            <button
              class="btn btn-ghost btn-xs"
              onclick={onprev}
              disabled={!canGoPrev}
              aria-label={m.pagination_prev_page()}
            >
              <IconChevronLeft class="size-4 {canGoPrev ? '' : 'opacity-40'}" aria-hidden="true" />
            </button>
          </div>
          <div class="tooltip tooltip-top" data-tip={m.pagination_next_page()}>
            <button
              class="btn btn-ghost btn-xs"
              onclick={onnext}
              disabled={!canGoNext}
              aria-label={m.pagination_next_page()}
            >
              <IconChevronRight class="size-4 {canGoNext ? '' : 'opacity-40'}" aria-hidden="true" />
            </button>
          </div>
          {#if showLast}
            <div class="tooltip tooltip-top" data-tip={m.pagination_last_page()}>
              <button
                class="btn btn-ghost btn-xs"
                onclick={onlast}
                disabled={!canGoLast}
                aria-label={m.pagination_last_page()}
              >
                <IconLastPage class="size-4 {canGoLast ? '' : 'opacity-40'}" aria-hidden="true" />
              </button>
            </div>
          {/if}
        </nav>
      {/if}
      {#if infoLabel}
        <span class="text-base-content/60 text-xs">{infoLabel}</span>
      {/if}
    </div>
    {@render pageSizeSelector()}
  </div>
{:else}
  <!-- Storage layout: page-size selector on left, info + buttons on right -->
  <div class="flex items-center justify-end gap-2">
    <div class="mr-4">
      {@render pageSizeSelector()}
    </div>
    {#if infoLabel}
      <span class="text-base-content/60 mr-1 text-xs">{infoLabel}</span>
    {/if}
    <nav class="flex items-center gap-1" aria-label={m.pagination_nav()}>
      <div class="tooltip tooltip-top" data-tip={m.pagination_first_page()}>
        <button
          class="btn btn-ghost btn-sm"
          onclick={onfirst}
          disabled={!canGoFirst}
          aria-label={m.pagination_first_page()}
        >
          <IconFirstPage class="size-4 {canGoFirst ? '' : 'opacity-40'}" aria-hidden="true" />
        </button>
      </div>
      <div class="tooltip tooltip-top" data-tip={m.pagination_prev_page()}>
        <button
          class="btn btn-ghost btn-sm"
          onclick={onprev}
          disabled={!canGoPrev}
          aria-label={m.pagination_prev_page()}
        >
          <IconChevronLeft class="size-4 {canGoPrev ? '' : 'opacity-40'}" aria-hidden="true" />
        </button>
      </div>
      <div class="tooltip tooltip-top" data-tip={m.pagination_next_page()}>
        <button
          class="btn btn-ghost btn-sm"
          onclick={onnext}
          disabled={!canGoNext}
          aria-label={m.pagination_next_page()}
        >
          <IconChevronRight class="size-4 {canGoNext ? '' : 'opacity-40'}" aria-hidden="true" />
        </button>
      </div>
      {#if showLast}
        <div class="tooltip tooltip-top" data-tip={m.pagination_last_page()}>
          <button
            class="btn btn-ghost btn-sm"
            onclick={onlast}
            disabled={!canGoLast}
            aria-label={m.pagination_last_page()}
          >
            <IconLastPage class="size-4 {canGoLast ? '' : 'opacity-40'}" aria-hidden="true" />
          </button>
        </div>
      {/if}
    </nav>
  </div>
{/if}
