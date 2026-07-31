<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { PageProps } from './$types';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import AddBookmarkModal from '$lib/components/dashboard/AddBookmarkModal.svelte';
  import { getBookmarks } from '$lib/dashboard/bookmarks.svelte.js';
  import { PRODUCTS } from '$lib/dashboard/products';
  import type { Bookmark } from '$lib/dashboard/types';

  let props: PageProps = $props();

  let addModalOpen = $state(false);
  let editingBookmark: Bookmark | null = $state(null);

  let bookmarks = $derived(getBookmarks());
  let pinnedBookmarks = $derived(bookmarks.filter((b) => b.pinned));
  let unpinnedBookmarks = $derived(bookmarks.filter((b) => !b.pinned));

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

  function handleLogoError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling;
    if (next) next.classList.remove('hidden');
  }

  function extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }
</script>

<AddBookmarkModal bind:open={addModalOpen} bookmark={editingBookmark} />

<div class="mx-auto max-w-6xl space-y-6">
  <div class="flex items-start justify-between">
    <div>
      <h2 class="text-base-content text-2xl font-bold">{m.dashboard_welcome()}</h2>
      <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_subtitle()}</p>
    </div>
    <button type="button" class="btn btn-primary btn-sm" onclick={openAddBookmark}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"><path d="M12 5v14M5 12h14" /></svg
      >
      {m.bookmark_add_title()}
    </button>
  </div>

  <div
    class="
      grid grid-cols-1 gap-4
      sm:grid-cols-2
      lg:grid-cols-3
    "
  >
    <div class="border-base-300 bg-base-100 rounded-xl border p-5">
      <p
        class="
          text-base-content/60 text-xs font-medium tracking-wider uppercase
        "
      >
        {m.dashboard_services()}
      </p>
      <p class="text-base-content mt-2 text-3xl font-bold">{props.data.serviceCount}</p>
      <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_services_empty()}</p>
    </div>

    <div class="border-base-300 bg-base-100 rounded-xl border p-5">
      <p
        class="
          text-base-content/60 text-xs font-medium tracking-wider uppercase
        "
      >
        {m.dashboard_queries()}
      </p>
      <p class="text-base-content mt-2 text-3xl font-bold">&mdash;</p>
      <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_queries_empty()}</p>
    </div>

    <div class="border-base-300 bg-base-100 rounded-xl border p-5">
      <p
        class="
          text-base-content/60 text-xs font-medium tracking-wider uppercase
        "
      >
        {m.dashboard_health()}
      </p>
      <p class="text-base-content mt-2 text-3xl font-bold">
        <span class="text-success">{m.dashboard_health_ok()}</span>
      </p>
      <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_health_status()}</p>
    </div>
  </div>

  {#if bookmarks.length > 0}
    <div class="border-base-300 bg-base-100 rounded-xl border p-6">
      <h3 class="text-base-content text-base font-semibold">{m.bookmark_section_title()}</h3>

      {#if pinnedBookmarks.length > 0}
        <div class="mt-4 space-y-2">
          <p class="text-base-content/50 text-xs font-medium tracking-wider uppercase">
            {m.bookmark_pinned_label()}
          </p>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {#each pinnedBookmarks as bookmark (bookmark.id)}
              {@const product = getProduct(bookmark.productId)}
              <div
                class="border-base-300 bg-base-200 hover:border-base-content/20 group relative rounded-xl border p-3 transition-colors"
              >
                <button
                  type="button"
                  class="btn btn-ghost btn-xs absolute top-1 right-1"
                  aria-label={m.bookmark_edit_label()}
                  onclick={() => openEditBookmark(bookmark)}
                >
                  <IconEdit class="size-3.5" />
                </button>

                <div class="flex items-center gap-2.5">
                  {#if product.logo}
                    <enhanced:img
                      src={product.logo}
                      alt={product.name}
                      class="size-8 rounded-lg bg-white object-contain p-1"
                      onerror={handleLogoError}
                    />
                    <span
                      class="flex hidden size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                      style="background-color: {product.color}"
                    >
                      {product.initials}
                    </span>
                  {:else}
                    <span
                      class="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                      style="background-color: {product.color}"
                    >
                      {product.initials}
                    </span>
                  {/if}
                  <div class="min-w-0">
                    <p class="text-base-content truncate text-sm leading-tight font-semibold">
                      {bookmark.name}
                    </p>
                    <div class="mt-0.5 flex flex-wrap items-center gap-1">
                      <span
                        class="bg-base-300 text-base-content/50 rounded px-1.5 py-0.5 text-[10px]"
                        >{product.name}</span
                      >
                      {#if bookmark.environment}
                        <span
                          class="bg-base-300 text-base-content/50 rounded px-1.5 py-0.5 text-[10px]"
                          >{bookmark.environment}</span
                        >
                      {/if}
                    </div>
                    <p class="text-base-content/40 mt-0.5 truncate text-[11px]">
                      {extractHostname(bookmark.url)}
                    </p>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if unpinnedBookmarks.length > 0}
        <div class="mt-4 space-y-2">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {#each unpinnedBookmarks as bookmark (bookmark.id)}
              {@const product = getProduct(bookmark.productId)}
              <div
                class="border-base-300 bg-base-200 hover:border-base-content/20 group relative rounded-xl border p-3 transition-colors"
              >
                <button
                  type="button"
                  class="btn btn-ghost btn-xs absolute top-1 right-1"
                  aria-label={m.bookmark_edit_label()}
                  onclick={() => openEditBookmark(bookmark)}
                >
                  <IconEdit class="size-3.5" />
                </button>

                <div class="flex items-center gap-2.5">
                  {#if product.logo}
                    <enhanced:img
                      src={product.logo}
                      alt={product.name}
                      class="size-8 rounded-lg bg-white object-contain p-1"
                      onerror={handleLogoError}
                    />
                    <span
                      class="flex hidden size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                      style="background-color: {product.color}"
                    >
                      {product.initials}
                    </span>
                  {:else}
                    <span
                      class="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                      style="background-color: {product.color}"
                    >
                      {product.initials}
                    </span>
                  {/if}
                  <div class="min-w-0">
                    <p class="text-base-content truncate text-sm leading-tight font-semibold">
                      {bookmark.name}
                    </p>
                    <div class="mt-0.5 flex flex-wrap items-center gap-1">
                      <span
                        class="bg-base-300 text-base-content/50 rounded px-1.5 py-0.5 text-[10px]"
                        >{product.name}</span
                      >
                      {#if bookmark.environment}
                        <span
                          class="bg-base-300 text-base-content/50 rounded px-1.5 py-0.5 text-[10px]"
                          >{bookmark.environment}</span
                        >
                      {/if}
                    </div>
                    <p class="text-base-content/40 mt-0.5 truncate text-[11px]">
                      {extractHostname(bookmark.url)}
                    </p>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="border-base-300 bg-base-100 rounded-xl border p-6">
    <h3 class="text-base-content text-base font-semibold">{m.dashboard_getting_started()}</h3>
    <p class="text-base-content/60 mt-2 text-sm/relaxed">
      {m.dashboard_getting_started_description()}
    </p>
    <ol class="mt-4 flex flex-wrap gap-3" aria-label={m.setup_steps_label()}>
      <li
        class="
          bg-base-200 text-base-content/70 flex items-center gap-2 rounded-lg px-3 py-2
          text-sm
        "
      >
        <span
          class="
            bg-primary/10 text-primary flex size-5 items-center justify-center
            rounded-full text-xs font-bold
          "
          aria-hidden="true">1</span
        >
        {m.dashboard_step_oidc()}
      </li>
      <li
        class="
          bg-base-200 text-base-content/70 flex items-center gap-2 rounded-lg px-3 py-2
          text-sm
        "
      >
        <span
          class="
            bg-primary/10 text-primary flex size-5 items-center justify-center
            rounded-full text-xs font-bold
          "
          aria-hidden="true">2</span
        >
        {m.dashboard_step_trino()}
      </li>
      <li
        class="
          bg-base-200 text-base-content/70 flex items-center gap-2 rounded-lg px-3 py-2
          text-sm
        "
      >
        <span
          class="
            bg-primary/10 text-primary flex size-5 items-center justify-center
            rounded-full text-xs font-bold
          "
          aria-hidden="true">3</span
        >
        {m.dashboard_step_browse()}
      </li>
    </ol>
  </div>
</div>
