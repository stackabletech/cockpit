<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconStar from 'virtual:icons/material-symbols/star';
  import IconStarOutline from 'virtual:icons/material-symbols/star-outline';
  import AddBookmarkModal from '$lib/components/dashboard/AddBookmarkModal.svelte';
  import { getBookmarks, togglePinBookmark } from '$lib/dashboard/bookmarks.svelte.js';
  import { PRODUCTS } from '$lib/dashboard/products';
  import type { Bookmark } from '$lib/dashboard/types';
  import type { PageData } from './$types';

  let { data = { isAdmin: false } as PageData }: { data?: PageData } = $props();

  let addModalOpen = $state(false);
  let editingBookmark: Bookmark | null = $state(null);
  let bookmarks = $derived(getBookmarks());

  function openEditBookmark(bookmark: Bookmark) {
    editingBookmark = bookmark;
    addModalOpen = true;
  }

  function openAddBookmark() {
    editingBookmark = null;
    addModalOpen = true;
  }

  function getProduct(productId: string) {
    return PRODUCTS.find((p) => p.id === productId) ?? PRODUCTS[PRODUCTS.length - 1];
  }

  function extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  function handleLogoError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling;
    if (next) next.classList.remove('hidden');
  }
</script>

<AddBookmarkModal bind:open={addModalOpen} bookmark={editingBookmark} isAdmin={data.isAdmin} />

<div class="mx-auto max-w-6xl space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-base-content text-2xl font-bold tracking-tight">{m.dashboard_welcome()}</h2>
      <p class="text-base-content/70 mt-1.5 max-w-xl text-sm">{m.dashboard_subtitle()}</p>
    </div>
    <button type="button" class="btn btn-primary btn-sm rounded-full" onclick={openAddBookmark}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
      >
      {m.bookmark_add_title()}
    </button>
  </div>

  <section aria-labelledby="bookmarks-heading">
    <div class="mb-2.5 flex items-baseline gap-2.5">
      <h3
        id="bookmarks-heading"
        class="text-base-content/70 text-xs font-bold tracking-wider uppercase"
      >
        {m.bookmark_section_title()}
      </h3>
      {#if bookmarks.length > 0}
        <span class="text-base-content/70 text-xs">
          {m.bookmark_count_links({ count: bookmarks.length })}
        </span>
      {/if}
    </div>

    {#if bookmarks.length > 0}
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {#each bookmarks as bookmark (bookmark.id)}
          {@const product = getProduct(bookmark.productId)}
          <div class="border-base-300 bg-base-100 flex items-center gap-3 rounded-lg border p-3">
            {#if product.logo}
              <enhanced:img
                src={product.logo}
                alt={product.name}
                class="size-[38px] shrink-0 rounded-md bg-white object-contain p-1"
                onerror={handleLogoError}
              />
              <span
                class="flex hidden size-[38px] shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold text-white"
                style="background-color: {product.color}"
                aria-hidden="true"
              >
                {product.initials}
              </span>
            {:else}
              <span
                class="flex size-[38px] shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold text-white"
                style="background-color: {product.color}"
                aria-hidden="true"
              >
                {product.initials}
              </span>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-baseline gap-1.5">
                <span class="text-base-content truncate text-[13.5px] leading-tight font-bold">
                  {bookmark.name}
                </span>
                {#if bookmark.environment}
                  <span class="text-base-content/70 shrink-0 text-[13px]"
                    >{bookmark.environment}</span
                  >
                {/if}
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5">
                <span class="bg-base-300 text-base-content/60 rounded-full px-2 py-0.5 text-[11px]">
                  {product.name}
                </span>
                {#if bookmark.environment}
                  <span
                    class="bg-base-300 text-base-content/60 rounded-full px-2 py-0.5 text-[11px]"
                  >
                    {bookmark.environment}
                  </span>
                {/if}
              </div>
              <div class="min-w-0">
                <span class="text-base-content/70 truncate font-mono text-[11.5px]">
                  {extractHostname(bookmark.url)}
                </span>
              </div>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-circle btn-sm size-7 shrink-0"
              aria-label={bookmark.pinned ? m.bookmark_unpin_label() : m.bookmark_pin_label()}
              onclick={() => togglePinBookmark(bookmark.id)}
            >
              {#if bookmark.pinned}
                <IconStar class="text-warning size-3.5" />
              {:else}
                <IconStarOutline class="size-3.5" />
              {/if}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-circle btn-sm size-7 shrink-0"
              aria-label={m.bookmark_edit_label()}
              onclick={() => openEditBookmark(bookmark)}
            >
              <IconEdit class="size-3.5" />
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="border-base-300 bg-base-100 rounded-lg border p-6 text-center">
        <p class="text-base-content/70 text-sm">{m.dashboard_bookmarks_empty()}</p>
      </div>
    {/if}
  </section>
</div>
