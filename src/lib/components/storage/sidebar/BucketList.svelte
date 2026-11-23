<script lang="ts">
  import { tick } from 'svelte';
  import { resolve } from '$app/paths';
  import IconPushPinOutline from 'virtual:icons/material-symbols/push-pin-outline';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import IconBucket from '../shared/BucketIcon.svelte';
  import IconFolderOutline from 'virtual:icons/material-symbols/folder-outline';
  import IconGridView from 'virtual:icons/material-symbols/grid-view';
  import IconPowerOff from 'virtual:icons/material-symbols/power-settings-new';
  import Modal from '$lib/components/ui/Modal.svelte';
  import TooltipTrigger from '$lib/components/ui/TooltipTrigger.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { PinnedLocation } from '$lib/storage/types.js';
  import { parseStorageDrop, canStorageDrop } from '$lib/storage/drag-handlers.js';
  import { locationLabel, locationHref } from '$lib/storage/display-helpers.js';
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

  // Storage state remains current when switching tabs via shallow routing,
  // whereas page.params still reflects the most recent full route navigation.
  const activeBucket = $derived(storage.bucket || null);
  const activePrefix = $derived(storage.prefix);

  function isPinnedActive(pin: PinnedLocation): boolean {
    return activeBucket === pin.bucket && activePrefix === pin.prefix;
  }

  // ── Unpin ───────────────────────────────────────────────────────────────
  let pinnedListEl = $state<HTMLUListElement>();
  let allBucketsLink = $state<HTMLAnchorElement>();

  /** Unpins and moves focus to the next unpin button, as the clicked one disappears with its row. */
  async function unpin(pin: PinnedLocation, index: number) {
    storage.bookmarks.unpin(pin.bucket, pin.prefix);
    await tick();
    const buttons = pinnedListEl?.querySelectorAll<HTMLElement>('[data-unpin]') ?? [];
    (buttons[Math.min(index, buttons.length - 1)] ?? allBucketsLink)?.focus();
  }

  // ── Bucket details context menu ───────────────────────────────────────────
  let bucketCtx = $state<{ x: number; y: number; bucket: string } | null>(null);

  function openBucketContextMenu(e: MouseEvent, bucket: string) {
    e.preventDefault();
    bucketCtx = { x: e.clientX, y: e.clientY, bucket };
  }

  function closeBucketContextMenu() {
    bucketCtx = null;
  }

  function openBucketDetails() {
    if (bucketCtx) storage.openModal('details', { type: 'bucket', bucket: bucketCtx.bucket });
  }

  // ── Drag-drop targets for sidebar items ────────────────────────────────
  let dropSidebarTarget = $state<string | null>(null);

  function handleSidebarDragOver(e: DragEvent, prefix: string) {
    if (!canStorageDrop(storage)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropSidebarTarget = prefix;
  }

  function handleSidebarDragLeave() {
    dropSidebarTarget = null;
  }

  function handleSidebarDrop(e: DragEvent, bucket: string, prefix: string) {
    dropSidebarTarget = null;
    if (!canStorageDrop(storage)) return;
    e.preventDefault();
    e.stopPropagation();
    const drop = parseStorageDrop(e);
    if (!drop) return;
    void storage.performMove(prefix, drop.keys, bucket, drop.source);
  }
</script>

<nav
  class="
    border-base-300 bg-base-100 relative flex shrink-0 flex-col
    rounded-lg border
  "
  style="width: var(--storage-sidebar-width, {resize.width}px)"
  aria-label={m.storage_buckets_label()}
>
  {#if !storage.connected || !storage.connectionHostname}
    <div class="flex flex-1 items-center justify-center">
      <span class="loading loading-md loading-spinner text-primary" aria-hidden="true"></span>
    </div>
  {:else}
    <!-- Pinned Access section -->
    {#if storage.bookmarks.pinnedLocations.length > 0}
      <div class="border-base-300 max-h-1/2 overflow-y-auto border-b">
        <div class="flex items-center px-3 py-2">
          <span class="text-muted text-xs font-semibold tracking-wide uppercase">
            {m.storage_pinned_label()}
          </span>
        </div>
        <ul bind:this={pinnedListEl} class="py-1" role="list">
          {#each storage.bookmarks.pinnedLocations as pin, index (pin.bucket + '::' + pin.prefix)}
            {@const active = isPinnedActive(pin)}
            <li class="group relative">
              <TooltipTrigger text={locationLabel(pin)} orientation="right">
                <a
                  href={locationHref(storage.connectionHostname, pin)}
                  data-sveltekit-preload-data="off"
                  class="
                    hover:bg-base-200 flex w-full min-w-0 items-center gap-2 px-3 py-1.5
                    pr-7 text-sm
                    {active ? 'bg-primary/10 text-primary font-medium' : 'text-base-content'}
                    {dropSidebarTarget === pin.prefix ? 'bg-primary/20' : ''}"
                  aria-current={active ? 'page' : undefined}
                  ondragover={(e) => handleSidebarDragOver(e, pin.prefix)}
                  ondragleave={handleSidebarDragLeave}
                  ondrop={(e) => handleSidebarDrop(e, pin.bucket, pin.prefix)}
                >
                  {#if pin.prefix === ''}
                    <IconBucket class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                  {:else}
                    <IconFolderOutline class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                  {/if}
                  <span class="truncate">{locationLabel(pin)}</span>
                </a>
              </TooltipTrigger>
              <TooltipTrigger text={m.storage_action_unpin()} orientation="right">
                <button
                  type="button"
                  class="
                    btn btn-ghost btn-xs absolute top-1/2 right-1 z-150 -translate-y-1/2
                    p-0 opacity-0 transition-opacity
                    group-hover:opacity-100 focus:opacity-100
                  "
                  data-unpin
                  onclick={() => unpin(pin, index)}
                  aria-label={m.storage_unpin_location({ label: locationLabel(pin) })}
                >
                  <IconPushPinOutline class="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
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
        text-muted text-xs font-semibold tracking-wide uppercase
      "
      >
        {m.storage_buckets_label()}
      </span>
      <a
        bind:this={allBucketsLink}
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

    <div class="min-h-0 flex-1 overflow-y-auto">
      <ul class="py-1" role="list">
        {#if storage.buckets.length === 0}
          <li class="text-muted px-3 py-4 text-center text-xs">
            {m.storage_buckets_empty()}
          </li>
        {:else}
          {#each storage.buckets as bucket (bucket)}
            <li>
              <TooltipTrigger text={bucket} orientation="right">
                <a
                  href={resolve('/(app)/storage/browse/[connection]/[bucket]/[...prefix]', {
                    connection: encodeURIComponent(storage.connectionHostname),
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
                  aria-current={activeBucket === bucket && !activePrefix ? 'page' : undefined}
                  oncontextmenu={(e) => openBucketContextMenu(e, bucket)}
                  ondragover={(e) => handleSidebarDragOver(e, '')}
                  ondragleave={handleSidebarDragLeave}
                  ondrop={(e) => handleSidebarDrop(e, bucket, '')}
                >
                  <IconBucket class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                  <span class="truncate">{bucket}</span>
                </a>
              </TooltipTrigger>
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
          class="btn text-muted btn-ghost btn-xs hover:text-error w-full"
          onclick={() => (disconnectConfirmOpen = true)}
        >
          {m.storage_disconnect()}
        </button>
      </form>
    </div>

    <ContextMenu
      x={bucketCtx?.x ?? 0}
      y={bucketCtx?.y ?? 0}
      open={bucketCtx !== null}
      onclose={closeBucketContextMenu}
      onaction={openBucketDetails}
      actions={[{ key: 'details', icon: IconInfo, label: m.storage_action_details() }]}
    />

    <!-- Disconnect confirmation modal -->
    <Modal bind:open={disconnectConfirmOpen}>
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
  {/if}

  <ResizeHandle panel={resize} />
</nav>
