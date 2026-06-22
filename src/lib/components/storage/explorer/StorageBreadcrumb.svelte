<script lang="ts">
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconFolderOutline from 'virtual:icons/material-symbols/folder-outline';
  import IconDescriptionOutline from 'virtual:icons/material-symbols/description-outline';
  import IconCheckBox from 'virtual:icons/material-symbols/check-box';
  import IconCheckBoxOutlineBlank from 'virtual:icons/material-symbols/check-box-outline-blank';
  import IconUpload from 'virtual:icons/material-symbols/upload';
  import IconMoreVert from 'virtual:icons/material-symbols/more-vert';
  import IconPushPin from 'virtual:icons/material-symbols/push-pin';
  import IconPushPinOutline from 'virtual:icons/material-symbols/push-pin-outline';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { StorageLocation } from '$lib/storage/types.js';

  const storage = getStorageState();

  const breadcrumbParts = $derived(
    storage.prefix
      ? storage.prefix
          .slice(0, -1)
          .split('/')
          .map((label, i, parts) => ({
            label,
            prefix: parts.slice(0, i + 1).join('/') + '/'
          }))
      : []
  );

  const MAX_TAIL = 2;
  const collapsedParts = $derived(
    breadcrumbParts.length > MAX_TAIL ? breadcrumbParts.slice(0, -MAX_TAIL) : []
  );
  const visibleParts = $derived(
    breadcrumbParts.length > MAX_TAIL ? breadcrumbParts.slice(-MAX_TAIL) : breadcrumbParts
  );

  const currentIsPinned = $derived(storage.bookmarks.isPinned(storage.bucket, storage.prefix));

  // ── Breadcrumb label context menu (right-click to pin / unpin) ───────────
  let breadcrumbCtx = $state<({ x: number; y: number } & StorageLocation) | null>(null);

  function openBreadcrumbCtx(e: MouseEvent, b: string, p: string) {
    e.preventDefault();
    breadcrumbCtx = { x: e.clientX, y: e.clientY, bucket: b, prefix: p };
  }

  function closeBreadcrumbCtx() {
    breadcrumbCtx = null;
  }
</script>

{#if breadcrumbCtx}
  {@const breadcrumbIsPinned = storage.bookmarks.isPinned(
    breadcrumbCtx.bucket,
    breadcrumbCtx.prefix
  )}
  {@const BreadcrumbPinIcon = breadcrumbIsPinned ? IconPushPin : IconPushPinOutline}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onmousedown={closeBreadcrumbCtx}
    onkeydown={(e) => e.key === 'Escape' && closeBreadcrumbCtx()}
  ></div>
  <ul
    class="
      menu menu-sm border-base-300 bg-base-100 fixed z-60 w-48 rounded-lg
      border p-1 shadow-lg
    "
    role="menu"
    style="left: {breadcrumbCtx.x}px; bottom: calc(100vh - {breadcrumbCtx.y}px);"
  >
    <li role="none">
      <button
        role="menuitem"
        class="justify-start {breadcrumbIsPinned ? 'text-error' : ''}"
        onclick={() => {
          if (storage.bookmarks.isPinned(breadcrumbCtx!.bucket, breadcrumbCtx!.prefix)) {
            storage.bookmarks.unpin(breadcrumbCtx!.bucket, breadcrumbCtx!.prefix);
          } else {
            storage.bookmarks.pin(breadcrumbCtx!.bucket, breadcrumbCtx!.prefix);
          }
          closeBreadcrumbCtx();
        }}
      >
        <BreadcrumbPinIcon class="size-4 shrink-0" aria-hidden="true" />
        {breadcrumbIsPinned ? m.storage_action_unpin() : m.storage_action_pin()}
      </button>
    </li>
  </ul>
{/if}

{#snippet pinButton(bucket: string, prefix: string)}
  {@const pinned = storage.bookmarks.isPinned(bucket, prefix)}
  {@const PinIcon = pinned ? IconPushPin : IconPushPinOutline}
  {@const UnpinIcon = pinned ? IconPushPinOutline : IconPushPin}
  <span
    class="
      pointer-events-none w-0 shrink-0 overflow-hidden
      group-hover:pointer-events-auto group-hover:w-5
      motion-safe:transition-[width] motion-safe:duration-150 motion-safe:group-hover:delay-700
    "
  >
    <button
      class="
          tooltip tooltip-bottom btn btn-ghost btn-xs group/pin z-60 size-5 p-0
          {pinned ? 'hover:text-error' : 'hover:text-white'}
        "
      data-tip={pinned ? m.storage_action_unpin() : m.storage_action_pin()}
      aria-label={pinned ? m.storage_action_unpin() : m.storage_action_pin()}
      onclick={() => {
        if (pinned) {
          storage.bookmarks.unpin(bucket, prefix);
        } else {
          storage.bookmarks.pin(bucket, prefix);
        }
      }}
    >
      <span class="relative inline-flex size-3.5">
        <span
          class="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/pin:opacity-0"
        >
          <PinIcon class="size-3.5" aria-hidden="true" />
        </span>
        <span
          class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover/pin:opacity-100"
        >
          <UnpinIcon class="size-3.5" aria-hidden="true" />
        </span>
      </span>
    </button>
  </span>
{/snippet}

<div class="border-base-300 flex flex-wrap items-center gap-3 border-b px-6 py-3">
  <!-- Breadcrumbs -->
  <nav
    aria-label="breadcrumb"
    class="
    flex min-w-0 flex-1 items-center gap-1 text-sm
  "
  >
    {#if breadcrumbParts.length === 0}
      <span class="group flex shrink-0 items-center gap-1">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="
            text-base-content flex shrink-0 items-center gap-1.5 rounded-sm px-1.5
            py-0.5 font-medium
          "
          title={storage.bucket}
          aria-current="page"
          oncontextmenu={(e) => openBreadcrumbCtx(e, storage.bucket, '')}
        >
          <IconStorage class="pointer-events-none size-4" aria-hidden="true" />
          {storage.bucket}
        </span>
        {@render pinButton(storage.bucket, '')}
      </span>
    {:else}
      <span class="group flex shrink-0 items-center gap-1">
        <button
          class="
            text-base-content/70 hover:bg-base-200 hover:text-base-content flex shrink-0 items-center gap-1.5
            rounded-sm px-1.5
            py-0.5 transition-colors hover:cursor-pointer
          "
          title={storage.bucket}
          onclick={() => storage.navigate('')}
          oncontextmenu={(e) => openBreadcrumbCtx(e, storage.bucket, '')}
        >
          <IconStorage class="size-4" aria-hidden="true" />
          {storage.bucket}
        </button>
        {@render pinButton(storage.bucket, '')}
      </span>
    {/if}
    {#if collapsedParts.length > 0}
      <IconChevronRight
        class="text-base-content/30 pointer-events-none size-4 shrink-0"
        aria-hidden="true"
      />
      <div class="dropdown">
        <button
          tabindex="0"
          class="
            hover:bg-base-200 hover:text-base-content flex items-center rounded-sm px-1.5
            py-0.5 transition-colors hover:cursor-pointer
            focus-visible:outline
          "
          aria-label={m.storage_breadcrumb_more()}
          aria-haspopup="listbox"
        >
          <IconMoreHoriz class="size-4" aria-hidden="true" />
        </button>
        <ul
          tabindex="0"
          role="listbox"
          aria-label={m.storage_breadcrumb_more()}
          class="
            dropdown-content menu rounded-box border-base-300 bg-base-100 z-50 w-48
            border p-1 shadow-lg
          "
        >
          {#each collapsedParts as part (part.prefix)}
            <li>
              <div class="group flex items-center justify-between gap-2">
                <button
                  class="flex-1 text-left text-sm hover:cursor-pointer"
                  onclick={() => storage.navigate(part.prefix)}
                  oncontextmenu={(e) => openBreadcrumbCtx(e, storage.bucket, part.prefix)}
                >
                  {part.label}
                </button>
                {@render pinButton(storage.bucket, part.prefix)}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#each visibleParts as part, i (part.prefix)}
      {@const isCurrent = i === visibleParts.length - 1}
      <IconChevronRight
        class="text-base-content/30 pointer-events-none size-4 shrink-0"
        aria-hidden="true"
      />
      <span class="group flex min-w-0 items-center gap-1">
        {#if isCurrent}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="
              text-base-content min-w-0 truncate rounded-sm px-1.5 py-0.5
              font-medium
            "
            title={part.label}
            aria-current="page"
            oncontextmenu={(e) => openBreadcrumbCtx(e, storage.bucket, part.prefix)}
          >
            {part.label}
          </span>
        {:else}
          <button
            class="
              hover:bg-base-200 hover:text-base-content min-w-0 truncate rounded-sm px-1.5
              py-0.5 transition-colors hover:cursor-pointer
            "
            title={part.label}
            onclick={() => storage.navigate(part.prefix)}
            oncontextmenu={(e) => openBreadcrumbCtx(e, storage.bucket, part.prefix)}
          >
            {part.label}
          </button>
        {/if}
        {@render pinButton(storage.bucket, part.prefix)}
      </span>
    {/each}
  </nav>

  <!-- Item count badges -->
  <div class="flex shrink-0 items-center gap-1.5">
    <span
      class="tooltip tooltip-bottom badge badge-soft badge-primary badge-sm z-60 gap-1"
      data-tip={m.storage_folder_count({ count: storage.folders.length })}
    >
      <IconFolderOutline class="size-4" aria-hidden="true" />
      <span class="font-bold">{storage.folders.length}</span>
    </span>
    <span
      class="tooltip tooltip-bottom badge badge-soft badge-primary badge-sm z-60 gap-1"
      data-tip={m.storage_file_count({ count: storage.files.length })}
    >
      <IconDescriptionOutline class="size-4" aria-hidden="true" />
      <span class="font-bold">{storage.files.length}</span>
    </span>
  </div>

  <!-- Multi-select toggle -->
  <button
    class={'btn btn-ghost btn-xs gap-1 ' +
      (storage.selectionMode ? 'bg-success/20 text-success' : '')}
    title={m.storage_select_toggle()}
    aria-pressed={storage.selectionMode}
    onclick={() => storage.toggleSelectionMode()}
  >
    <span
      class={'swap swap-rotate ' + (storage.selectionMode ? 'swap-active' : '')}
      aria-hidden="true"
    >
      <IconCheckBox class="swap-on size-3.5" />
      <IconCheckBoxOutlineBlank class="swap-off size-3.5" />
    </span>
    {m.storage_select_toggle()}
  </button>

  <!-- Upload button -->
  <button
    class="btn btn-primary btn-xs gap-1"
    onclick={() => storage.openModal('upload', { bucket: storage.bucket, prefix: storage.prefix })}
  >
    <IconUpload class="size-3.5" aria-hidden="true" />
    {m.storage_action_upload()}
  </button>

  <!-- More options (pin current location) -->
  <div class="dropdown dropdown-end">
    <button
      tabindex="0"
      class="btn btn-ghost btn-xs"
      title={m.storage_more_options()}
      aria-label={m.storage_more_options()}
      aria-haspopup="menu"
    >
      <IconMoreVert class="size-3.5" aria-hidden="true" />
    </button>
    <ul
      tabindex="0"
      role="menu"
      class="
        dropdown-content menu rounded-box border-base-300 bg-base-100 z-50 w-52
        border p-1 shadow-lg
      "
    >
      <li role="none">
        {#if currentIsPinned}
          {@const PinIcon2 = IconPushPin}
          <button
            role="menuitem"
            class="justify-start text-sm"
            onclick={() => {
              storage.bookmarks.unpin(storage.bucket, storage.prefix);
            }}
          >
            <PinIcon2 class="size-4 shrink-0" aria-hidden="true" />
            {m.storage_action_unpin()}
          </button>
        {:else}
          {@const PinIcon2 = IconPushPinOutline}
          <button
            role="menuitem"
            class="justify-start text-sm"
            onclick={() => {
              storage.bookmarks.pin(storage.bucket, storage.prefix);
            }}
          >
            <PinIcon2 class="size-4 shrink-0" aria-hidden="true" />
            {m.storage_action_pin()}
          </button>
        {/if}
      </li>
    </ul>
  </div>
</div>
