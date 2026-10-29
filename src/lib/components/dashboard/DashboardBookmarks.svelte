<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages.js';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconStar from 'virtual:icons/material-symbols/star';
  import IconStarOutline from 'virtual:icons/material-symbols/star-outline';
  import AddBookmarkModal from '$lib/components/dashboard/AddBookmarkModal.svelte';
  import { updateBookmark } from '$lib/dashboard/bookmarks-api.js';
  import { addToast } from '$lib/stores/toast.svelte.js';
  import { getProduct } from '$lib/dashboard/products';
  import ProductIcon from '$lib/components/dashboard/ProductIcon.svelte';
  import { bookmarkHostname, type Bookmark } from '$lib/dashboard/types';

  let {
    bookmarks
  }: {
    /** Null when loading them failed: the section says so instead of listing them. */
    bookmarks: Bookmark[] | null;
  } = $props();

  let addModalOpen = $state(false);
  let editingBookmark: Bookmark | null = $state(null);
  const pinning = new SvelteSet<string>();

  function openEditBookmark(bookmark: Bookmark) {
    editingBookmark = bookmark;
    addModalOpen = true;
  }

  function openAddBookmark() {
    editingBookmark = null;
    addModalOpen = true;
  }

  async function togglePin(bookmark: Bookmark) {
    if (pinning.has(bookmark.id)) return;
    pinning.add(bookmark.id);
    try {
      await updateBookmark(bookmark.id, { pinned: !bookmark.pinned });
    } catch {
      addToast('error', m.bookmark_pin_error({ name: bookmark.name }));
    } finally {
      pinning.delete(bookmark.id);
    }
  }
</script>

{#if bookmarks}
  <AddBookmarkModal bind:open={addModalOpen} bookmark={editingBookmark} />
{/if}

<section aria-labelledby="bookmarks-heading">
  <div class="mb-2.5 flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <div class="flex items-baseline gap-2.5">
        <h3
          id="bookmarks-heading"
          class="text-base-content/70 text-xs font-bold tracking-wider uppercase"
        >
          {m.bookmark_section_title()}
        </h3>
        {#if bookmarks?.length}
          <span class="text-base-content/70 text-xs">
            {m.bookmark_count_links({ count: bookmarks.length })}
          </span>
        {/if}
      </div>
      {#if bookmarks}
        <p class="text-base-content/70 mt-1.5 max-w-xl text-sm">{m.dashboard_subtitle()}</p>
      {/if}
    </div>
    {#if bookmarks}
      <button type="button" class="btn btn-primary btn-sm rounded-full" onclick={openAddBookmark}>
        <IconAdd class="size-4" aria-hidden="true" />
        {m.bookmark_add_title()}
      </button>
    {/if}
  </div>

  {#if !bookmarks}
    <div class="alert alert-warning text-sm">{m.bookmark_load_error()}</div>
  {:else if bookmarks.length > 0}
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {#each bookmarks as bookmark (bookmark.id)}
        {@const product = getProduct(bookmark.productId)}
        <div class="border-base-300 bg-base-100 flex items-center gap-3 rounded-lg border p-3">
          <!-- Mouse shortcut only: duplicates the title link, so it is hidden from
             assistive technology and the tab order. -->
          <a
            href={bookmark.url}
            target="_blank"
            rel="external noopener noreferrer"
            class="shrink-0"
            tabindex="-1"
            aria-hidden="true"
          >
            <ProductIcon {product} size="md" />
          </a>
          <div class="min-w-0 flex-1">
            <div class="min-w-0">
              <a
                href={bookmark.url}
                target="_blank"
                rel="external noopener noreferrer"
                class="text-base-content block truncate text-[13.5px] leading-tight font-bold"
              >
                {bookmark.name}
              </a>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span class="bg-base-300 text-muted rounded-full px-2 py-0.5 text-[11px]">
                {product.name}
              </span>
              {#if bookmark.environment}
                <span class="bg-base-300 text-muted rounded-full px-2 py-0.5 text-[11px]">
                  {bookmark.environment}
                </span>
              {/if}
            </div>
            <div class="min-w-0">
              <span class="text-base-content/70 block truncate font-mono text-[11.5px]">
                {bookmarkHostname(bookmark.url)}
              </span>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-circle btn-sm size-7 shrink-0"
            aria-label={bookmark.pinned
              ? m.bookmark_card_unpin({ name: bookmark.name })
              : m.bookmark_card_pin({ name: bookmark.name })}
            class:btn-disabled={pinning.has(bookmark.id)}
            aria-disabled={pinning.has(bookmark.id)}
            onclick={() => togglePin(bookmark)}
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
            aria-label={m.bookmark_card_edit({ name: bookmark.name })}
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
