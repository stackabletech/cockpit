<script lang="ts">
  import { browser } from '$app/environment';
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
  import { storageMoveEnabled } from '$lib/client/feature-flags.js';
  import type { PinnedLocation, StorageLocation } from '$lib/storage/types.js';
  import { pinnedLabel, pinnedHref } from '$lib/storage/display-helpers.js';

  const storage = getStorageState();

  // ── Resizable sidebar ─────────────────────────────────────────────────────
  const SIDEBAR_WIDTH_KEY = 'storage_sidebar_width';
  const DEFAULT_WIDTH = 192; // matches previous w-48
  const MIN_WIDTH = 120;
  const MAX_WIDTH = 480;

  function getInitialWidth(): number {
    if (!browser) return DEFAULT_WIDTH;
    try {
      const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) return parsed;
      }
    } catch {
      /* ignore storage errors */
    }
    return DEFAULT_WIDTH;
  }

  function saveWidth(width: number) {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      /* ignore storage errors */
    }
  }

  let sidebarWidth = $state(getInitialWidth());
  let isDragging = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  function onResizeStart(e: PointerEvent) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartWidth = sidebarWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onResizeMove(e: PointerEvent) {
    if (!isDragging) return;
    const delta = e.clientX - dragStartX;
    sidebarWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth + delta));
  }

  function onResizeEnd() {
    if (!isDragging) return;
    isDragging = false;
    saveWidth(sidebarWidth);
  }

  function onResizeKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowRight') {
      sidebarWidth = Math.min(MAX_WIDTH, sidebarWidth + step);
      saveWidth(sidebarWidth);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      sidebarWidth = Math.max(MIN_WIDTH, sidebarWidth - step);
      saveWidth(sidebarWidth);
      e.preventDefault();
    }
  }

  // Keep the col-resize cursor active across the whole page while dragging so
  // it doesn't flicker when the pointer moves faster than the DOM updates.
  $effect(() => {
    if (!browser) return;
    if (isDragging) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // ── Disconnect confirmation ───────────────────────────────────────────────
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

  // ── Drag-drop targets for sidebar items ────────────────────────────────
  let dropSidebarTarget = $state<string | null>(null);

  function handleSidebarDragOver(e: DragEvent, prefix: string) {
    if (!storageMoveEnabled || storage.isInArchive) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropSidebarTarget = prefix;
  }

  function handleSidebarDragLeave() {
    dropSidebarTarget = null;
  }

  function handleSidebarDrop(e: DragEvent, _bucket: string, prefix: string) {
    dropSidebarTarget = null;
    if (!storageMoveEnabled || storage.isInArchive) return;
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer?.getData('application/x-storage-keys');
    if (!raw) return;
    try {
      const keys: string[] = JSON.parse(raw);
      void storage.performMove(prefix, keys);
    } catch {
      // invalid JSON - ignore
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
  style="width: {sidebarWidth}px"
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
                {active ? 'bg-primary/10 text-primary font-medium' : 'text-base-content'}
                {dropSidebarTarget === pin.prefix ? 'bg-primary/20' : ''}"
              aria-current={active ? 'page' : undefined}
              onmouseenter={(e) => showTooltip(e, pinnedLabel(pin))}
              onmouseleave={hideTooltip}
              onfocus={(e) => showTooltip(e, pinnedLabel(pin))}
              onblur={hideTooltip}
              ondragover={(e) => handleSidebarDragOver(e, pin.prefix)}
              ondragleave={handleSidebarDragLeave}
              ondrop={(e) => handleSidebarDrop(e, pin.bucket, pin.prefix)}
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
                : 'text-base-content'}
                  {dropSidebarTarget === '' && activeBucket === bucket ? 'bg-primary/20' : ''}"
              aria-current={activeBucket === bucket && !page.params.prefix ? 'page' : undefined}
              onmouseenter={(e) => showTooltip(e, bucket)}
              onmouseleave={hideTooltip}
              onfocus={(e) => showTooltip(e, bucket)}
              onblur={hideTooltip}
              ondragover={(e) => handleSidebarDragOver(e, '')}
              ondragleave={handleSidebarDragLeave}
              ondrop={(e) => handleSidebarDrop(e, bucket, '')}
            >
              <IconBucket class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              <span class="truncate">{bucket}</span>
            </a>
          </li>
        {/each}
      {/if}
    </ul>
  </div>

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

  <!-- Drag-to-resize handle -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label={m.storage_sidebar_resize_handle()}
    aria-valuenow={sidebarWidth}
    aria-valuemin={MIN_WIDTH}
    aria-valuemax={MAX_WIDTH}
    tabindex="0"
    class="
      focus-visible:outline-primary/50 absolute inset-y-0 -right-2 z-10 w-4 cursor-col-resize
      touch-none rounded-r-lg
      select-none focus-visible:outline-2 focus-visible:outline-offset-0
    "
    onpointerdown={onResizeStart}
    onpointermove={onResizeMove}
    onpointerup={onResizeEnd}
    onpointercancel={onResizeEnd}
    onkeydown={onResizeKeydown}
  >
    <div
      class="
        absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full
        transition-colors duration-100
        {isDragging ? 'bg-primary' : 'bg-base-300 hover:bg-primary/50'}
      "
    ></div>
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
