<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconStar from 'virtual:icons/material-symbols/star';
  import IconStarOutline from 'virtual:icons/material-symbols/star-outline';
  import { getProduct } from '$lib/dashboard/products';
  import ProductIcon from '$lib/components/dashboard/ProductIcon.svelte';
  import { bookmarkHostname, type BookmarkLink } from '$lib/dashboard/types';

  let {
    bookmark,
    pinPending = false,
    onTogglePin,
    onEdit
  }: {
    bookmark: BookmarkLink;
    pinPending?: boolean;
    onTogglePin: () => void;
    onEdit: () => void;
  } = $props();

  const product = $derived(getProduct(bookmark.productId));
</script>

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
    class:btn-disabled={pinPending}
    aria-disabled={pinPending}
    onclick={onTogglePin}
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
    onclick={onEdit}
  >
    <IconEdit class="size-3.5" />
  </button>
</div>
