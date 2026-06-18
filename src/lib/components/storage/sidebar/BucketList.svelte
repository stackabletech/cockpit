<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { beforeNavigate } from '$app/navigation';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconPushPinOutline from 'virtual:icons/material-symbols/push-pin-outline';
  import IconBucket from '../shared/BucketIcon.svelte';
  import IconFolderOutline from 'virtual:icons/material-symbols/folder-outline';
  import IconGridView from 'virtual:icons/material-symbols/grid-view';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { PinnedLocation, StorageLocation } from '$lib/storage/types.js';
  import { pinnedLabel, pinnedHref } from '$lib/storage/display-helpers.js';

  const storage = getStorageState();

  // page.url may be undefined in the error boundary state (when a client-side
  // universal load throws and SvelteKit transitions to the error state). Guard
  // with optional chaining to avoid crashing the layout and escalating the
  // error to the root fallback handler.
  const activeBucket = $derived.by(() => {
    const match = page.url?.pathname?.match(/^\/storage\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  const activePrefix = $derived(page.params.prefix ? page.params.prefix + '/' : '');

  function isPinnedActive(pin: PinnedLocation): boolean {
    return page.params.bucket === pin.bucket && activePrefix === pin.prefix;
  }

  // ── Unpin context menu ────────────────────────────────────────────────────
  let unpinCtx = $state<({ x: number; y: number } & StorageLocation) | null>(null);
  let menuEl = $state<HTMLUListElement | null>(null);

  const adjustedPos = $derived.by(() => {
    if (!unpinCtx) return { left: 0, top: 0 };
    if (!menuEl) return { left: unpinCtx.x, top: unpinCtx.y };
    const rect = menuEl.getBoundingClientRect();
    return {
      left: unpinCtx.x + rect.width > window.innerWidth ? unpinCtx.x - rect.width : unpinCtx.x,
      top: unpinCtx.y + rect.height > window.innerHeight ? unpinCtx.y - rect.height : unpinCtx.y
    };
  });

  function handleOutsideClick(e: MouseEvent) {
    if (unpinCtx && menuEl && !menuEl.contains(e.target as Node)) closeUnpinMenu();
  }

  function openUnpinMenuFromButton(e: MouseEvent, pin: PinnedLocation) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    unpinCtx = { x: rect.right, y: rect.bottom, bucket: pin.bucket, prefix: pin.prefix };
  }

  function closeUnpinMenu() {
    unpinCtx = null;
  }
  beforeNavigate(closeUnpinMenu);

  function handleKeydown(e: KeyboardEvent) {
    if (unpinCtx && e.key === 'Escape') closeUnpinMenu();
  }

  function handleUnpin() {
    if (unpinCtx) {
      storage.bookmarks.unpin(unpinCtx.bucket, unpinCtx.prefix);
      closeUnpinMenu();
    }
  }

  // ── Fixed tooltip (avoids overflow clipping that breaks DaisyUI tooltips) ──
  // TODO: This is a temporary solution until it's fixed in daisyUI 5.6: https://github.com/saadeghi/daisyui/issues/3346#issuecomment-4544975800
  let tooltipText = $state<string | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  function showTooltip(e: MouseEvent | FocusEvent, text: string) {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    tooltipX = rect.right + 8;
    tooltipY = rect.top + rect.height / 2;
    tooltipText = text;
  }

  function hideTooltip() {
    tooltipText = null;
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:document onclick={handleOutsideClick} />

{#if unpinCtx}
  <ul
    bind:this={menuEl}
    {@attach (node) => node.focus()}
    class="
      menu menu-sm border-base-300 bg-base-100 fixed z-150 w-48 rounded-lg
      border p-1 shadow-lg
    "
    role="menu"
    tabindex="-1"
    style="left: {adjustedPos.left}px; top: {adjustedPos.top}px;"
  >
    <li class="menu-title p-0" role="none">
      <div class="menu-title flex items-center justify-between py-1 pr-0 pl-2">
        <span class="text-base-content/70 text-xs font-medium">
          {m.storage_context_menu_actions()}
        </span>
        <button
          type="button"
          role="menuitem"
          class="btn btn-ghost btn-xs"
          aria-label={m.storage_preview_close()}
          onclick={closeUnpinMenu}
        >
          <IconClose class="size-4" aria-hidden="true" />
        </button>
      </div>
    </li>
    <li role="none">
      <button role="menuitem" class="justify-start" onclick={handleUnpin}>
        <IconPushPinOutline class="mr-2 size-4 shrink-0" aria-hidden="true" />
        {m.storage_action_unpin()}
      </button>
    </li>
  </ul>
{/if}

<nav
  class="
    border-base-300 bg-base-100 flex w-48 shrink-0 flex-col
    rounded-lg border
  "
  aria-label={m.storage_buckets_label()}
>
  <!-- Pinned Access section -->
  {#if storage.bookmarks.pinnedLocations.length > 0}
    <div class="border-base-300 max-h-1/2 overflow-y-auto border-b">
      <div class="flex items-center px-3 py-2">
        <span class="text-base-content/50 text-xs font-semibold tracking-wide uppercase">
          {m.storage_pinned_label()}
        </span>
      </div>
      <ul class="py-1" role="list">
        {#each storage.bookmarks.pinnedLocations as pin (pin.bucket + '::' + pin.prefix)}
          {@const active = isPinnedActive(pin)}
          <li role="none" class="group relative">
            <!-- eslint-disable svelte/no-navigation-without-resolve -->
            <a
              href={pinnedHref(pin)}
              data-sveltekit-preload-data="off"
              class="
              hover:bg-base-200 flex w-full min-w-0 items-center gap-2 px-3 py-1.5
              pr-7 text-sm
              {active ? 'bg-primary/10 text-primary font-medium' : 'text-base-content'}"
              aria-current={active ? 'page' : undefined}
              onmouseenter={(e) => showTooltip(e, pinnedLabel(pin))}
              onmouseleave={hideTooltip}
              onfocus={(e) => showTooltip(e, pinnedLabel(pin))}
              onblur={hideTooltip}
            >
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {#if pin.prefix === ''}
                <IconBucket class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              {:else}
                <IconFolderOutline class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              {/if}
              <span class="truncate">{pinnedLabel(pin)}</span>
            </a>
            <button
              class="
                btn btn-ghost btn-xs absolute top-1/2 right-1 z-60 -translate-y-1/2
                p-0 opacity-0 transition-opacity
                group-hover:opacity-100 focus:opacity-100
              "
              onclick={(e) => openUnpinMenuFromButton(e, pin)}
              aria-label={m.storage_more_options()}
              title={m.storage_more_options()}
            >
              <IconMoreHoriz class="size-3.5" aria-hidden="true" />
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div
    class="
      border-base-300 flex items-center justify-between border-b px-3 py-2
    "
  >
    <span
      class="
        text-base-content/50 text-xs font-semibold tracking-wide uppercase
      "
    >
      {m.storage_buckets_label()}
    </span>
    <a
      href={resolve('/storage')}
      data-sveltekit-preload-data="off"
      class="btn btn-ghost btn-xs group tooltip tooltip-right z-60"
      title={m.storage_view_all_buckets()}
      data-tip={m.storage_view_all_buckets()}
    >
      <IconGridView
        class="group-hover:text-primary size-3.5 transition-colors"
        aria-hidden="true"
      />
    </a>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    <ul class="py-1" role="list">
      {#if storage.buckets.length === 0}
        <li class="text-base-content/40 px-3 py-4 text-center text-xs">
          {m.storage_buckets_empty()}
        </li>
      {:else}
        {#each storage.buckets as bucket (bucket)}
          <li role="none">
            <a
              href={resolve('/(app)/storage/[bucket]/[...prefix]', {
                bucket: encodeURIComponent(bucket),
                prefix: ''
              })}
              data-sveltekit-preload-data="off"
              class="
                hover:bg-base-200 flex items-center gap-2
                px-3 py-1.5 text-sm
                {activeBucket === bucket
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-base-content'}"
              aria-current={activeBucket === bucket && !page.params.prefix ? 'page' : undefined}
              onmouseenter={(e) => showTooltip(e, bucket)}
              onmouseleave={hideTooltip}
              onfocus={(e) => showTooltip(e, bucket)}
              onblur={hideTooltip}
            >
              <IconBucket class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              <span class="truncate">{bucket}</span>
            </a>
          </li>
        {/each}
      {/if}
    </ul>
  </div>

  <!-- TODO: This needs to be a two step process to avoid unintentional disconnects from misclicks -->
  <!-- Disconnect button -->
  <div class="border-base-300 border-t p-2">
    <form method="POST" action="/storage?/disconnect">
      <button
        type="submit"
        class="
        btn text-base-content/60 btn-ghost btn-xs hover:text-error w-full
      "
      >
        {m.storage_disconnect()}
      </button>
    </form>
  </div>
</nav>

{#if tooltipText}
  <div
    class="bg-neutral text-neutral-content pointer-events-none fixed z-150 rounded px-2 py-1 text-sm whitespace-nowrap shadow-lg"
    style="left: {tooltipX}px; top: {tooltipY}px; transform: translateY(-50%)"
    role="tooltip"
  >
    {tooltipText}
  </div>
{/if}
