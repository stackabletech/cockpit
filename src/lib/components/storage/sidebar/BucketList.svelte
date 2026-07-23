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
  import IconPowerOff from 'virtual:icons/material-symbols/power-settings-new';
  import Modal from '$lib/components/Modal.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { PinnedLocation, StorageLocation } from '$lib/storage/types.js';
  import { pinnedLabel, pinnedHref } from '$lib/storage/display-helpers.js';
  import { createResizablePanel } from './resizable-panel.svelte.js';
  import ResizeHandle from './ResizeHandle.svelte';

  const storage = getStorageState();

  const resize = createResizablePanel({
    storageKey: 'storage_sidebar_width',
    defaultWidth: 192,
    minWidth: 120,
    maxWidth: 480
  });

  // ── Disconnect confirmation ──────────────────────────────────────────────
  let disconnectConfirmOpen = $state(false);
  let disconnectForm = $state<HTMLFormElement | null>(null);

  function confirmDisconnect() {
    disconnectConfirmOpen = false;
    disconnectForm?.requestSubmit();
  }

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
    border-base-300 bg-base-100 relative flex shrink-0 flex-col
    rounded-lg border
  "
  style="width: var({resize.cssVarName}, {resize.width}px)"
  aria-label={m.storage_buckets_label()}
>
  {#if storage.connected}
    <!-- Pinned Access section -->
    {#if storage.bookmarks.pinnedLocations.length > 0}
      <div class="border-base-300 border-b">
        <div class="flex items-center px-3 py-2">
          <span class="text-base-content/50 text-xs font-semibold tracking-wide uppercase">
            {m.storage_pinned_label()}
          </span>
        </div>
        <ul class="py-1" role="list">
          {#each storage.bookmarks.pinnedLocations as pin (pin.bucket + '::' + pin.prefix)}
            {@const active = isPinnedActive(pin)}
            <li role="none" class="group relative">
              <div
                class="tooltip tooltip-right relative z-150 w-full before:z-200"
                data-tip={pinnedLabel(pin)}
              >
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <a
                  href={pinnedHref(pin)}
                  data-sveltekit-preload-data="off"
                  class="
                  hover:bg-base-200 flex w-full min-w-0 items-center gap-2 px-3 py-1.5
                  pr-7 text-sm
                  {active ? 'bg-primary/10 text-primary font-medium' : 'text-base-content'}"
                  aria-current={active ? 'page' : undefined}
                >
                  <!-- eslint-enable svelte/no-navigation-without-resolve -->
                  {#if pin.prefix === ''}
                    <IconBucket class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                  {:else}
                    <IconFolderOutline class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                  {/if}
                  <span class="truncate">{pinnedLabel(pin)}</span>
                </a>
              </div>
              <button
                class="
                  btn btn-ghost btn-xs absolute top-1/2 right-1 z-150 -translate-y-1/2
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
        class="btn btn-ghost btn-xs group tooltip tooltip-right z-150 before:z-200"
        title={m.storage_view_all_buckets()}
        data-tip={m.storage_view_all_buckets()}
      >
        <IconGridView
          class="group-hover:text-primary size-3.5 transition-colors"
          aria-hidden="true"
        />
      </a>
    </div>

    <ul class="flex-1 py-1" role="list">
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
                hover:bg-base-200 tooltip tooltip-right flex items-center gap-2 px-3
                py-1.5 text-sm before:z-200
                {activeBucket === bucket
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-base-content'}"
              data-tip={bucket}
              aria-current={activeBucket === bucket && !page.params.prefix ? 'page' : undefined}
            >
              <IconBucket class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              <span class="truncate">{bucket}</span>
            </a>
          </li>
        {/each}
      {/if}
    </ul>

    <!-- Disconnect button -->
    <div class="border-base-300 border-t p-2">
      <form bind:this={disconnectForm} method="POST" action="/storage?/disconnect">
        <button
          type="button"
          class="btn text-base-content/60 btn-ghost btn-xs hover:text-error w-full"
          onclick={() => (disconnectConfirmOpen = true)}
        >
          {m.storage_disconnect()}
        </button>
      </form>
    </div>

    <!-- Disconnect confirmation modal -->
    <Modal bind:open={disconnectConfirmOpen} class="modal">
      <div class="modal-box max-w-sm">
        <h3 class="mb-3 flex items-center gap-2 text-lg font-bold">
          <IconPowerOff class="text-error size-5 shrink-0" aria-hidden="true" />
          {m.storage_disconnect_confirm_title()}
        </h3>
        <p class="text-base-content/80 text-sm">
          {m.storage_disconnect_confirm_message()}
        </p>
        <div class="modal-action mt-6">
          <button class="btn btn-ghost" onclick={() => (disconnectConfirmOpen = false)}>
            {m.storage_disconnect_cancel()}
          </button>
          <button class="btn btn-outline btn-error" onclick={confirmDisconnect}>
            <IconPowerOff class="size-4" aria-hidden="true" />
            {m.storage_disconnect_confirm_button()}
          </button>
        </div>
      </div>
    </Modal>
  {:else}
    <div
      class="flex flex-1 items-center justify-center"
      aria-live="polite"
      aria-label={m.storage_loading()}
    >
      <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
    </div>
  {/if}

  <ResizeHandle panel={resize} />
</nav>
