<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages.js';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import AddBookmarkModal from '$lib/components/dashboard/AddBookmarkModal.svelte';
  import BookmarkCard from '$lib/components/dashboard/BookmarkCard.svelte';
  import { updateBookmark } from '$lib/dashboard/bookmarks-api.js';
  import { addToast } from '$lib/stores/toast.svelte.js';
  import type { Bookmark } from '$lib/dashboard/types';

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
        <BookmarkCard
          {bookmark}
          pinPending={pinning.has(bookmark.id)}
          onTogglePin={() => togglePin(bookmark)}
          onEdit={() => openEditBookmark(bookmark)}
        />
      {/each}
    </div>
  {:else}
    <div class="border-base-300 bg-base-100 rounded-lg border p-6 text-center">
      <p class="text-base-content/70 text-sm">{m.dashboard_bookmarks_empty()}</p>
    </div>
  {/if}
</section>
