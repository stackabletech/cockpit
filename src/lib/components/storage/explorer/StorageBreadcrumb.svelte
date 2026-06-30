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
  import IconFolderZip from 'virtual:icons/material-symbols/folder-zip';
  import IconTab from 'virtual:icons/material-symbols/tab';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import { getTabsState } from '$lib/storage/tabs-context.js';
  import type { StorageLocation } from '$lib/storage/types.js';
  import { keyToName } from '$lib/storage/utils.js';
  import { invalidateAll } from '$app/navigation';
  import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';

  const storage = getStorageState();
  const tabsState = getTabsState();

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

  const archiveParts = $derived(
    storage.isInArchive && storage.archiveKey
      ? [
          ...(storage.archivePrefix
            ? storage.archivePrefix
                .replace(/\/$/, '')
                .split('/')
                .map((label, i, parts) => ({
                  label,
                  isArchive: false,
                  prefix: parts.slice(0, i + 1).join('/') + '/'
                }))
            : [])
        ]
      : []
  );

  const archiveName = $derived(storage.archiveKey ? keyToName(storage.archiveKey) : '');
  const nestedArchiveName = $derived(
    storage.archiveNestedPath ? keyToName(storage.archiveNestedPath) : ''
  );

  const MAX_TAIL = 2;
  const collapsedParts = $derived(
    breadcrumbParts.length > MAX_TAIL ? breadcrumbParts.slice(0, -MAX_TAIL) : []
  );
  const visibleParts = $derived(
    breadcrumbParts.length > MAX_TAIL ? breadcrumbParts.slice(-MAX_TAIL) : breadcrumbParts
  );

  const currentIsPinned = $derived(storage.bookmarks.isPinned(storage.bucket, storage.prefix));

  // ── Create menu (inline dropdown) ─────────────────────────────────────
  let createOpen = $state(false);
  let createType = $state<'file' | 'folder'>('file');
  let createName = $state('');
  let createStep = $state<'choose' | 'name'>('choose');
  let creating = $state(false);
  let createError = $state('');

  const NAME_INVALID_CHARS = /[^\w\s./()\-+@,:;!$*'=]/g;

  function sanitizeName(raw: string): string {
    return raw.replace(NAME_INVALID_CHARS, '');
  }

  function openCreate() {
    createOpen = true;
    createStep = 'choose';
    createType = 'file';
    createName = '';
    createError = '';
  }

  function closeCreate() {
    createOpen = false;
  }

  function selectCreateType(type: 'file' | 'folder') {
    createType = type;
    createStep = 'name';
    createName = type === 'file' ? 'untitled.txt' : 'new-folder';
    createError = '';
  }

  async function createObject(bucket: string, key: string): Promise<void> {
    const params = new URLSearchParams({ bucket, key });
    const conn = loadConnectionLocally();
    const headers: HeadersInit = conn ? { 'x-storage-connection': getConnectionHeader(conn) } : {};
    const res = await fetch(`/api/storage/create?${params}`, { method: 'POST', headers });
    if (!res.ok) throw new Error(`Create failed with status ${res.status}`);
  }

  async function handleCreate() {
    const name = sanitizeName(createName.trim());
    if (!name || name === '.' || name === '..') {
      createError = m.storage_create_error({ name: createName });
      return;
    }
    creating = true;
    createError = '';

    try {
      const isFolder = createType === 'folder';
      const parts = name.split('/');

      // Create intermediate directory markers for each path segment
      for (let i = 0; i < parts.length - 1; i++) {
        const dirKey = storage.prefix + parts.slice(0, i + 1).join('/') + '/';
        await createObject(storage.bucket, dirKey);
      }

      // Create the final object (file or directory)
      const finalKey = storage.prefix + name + (isFolder ? '/' : '');
      await createObject(storage.bucket, finalKey);

      closeCreate();
      storage.loading = true;
      void invalidateAll();
    } catch {
      createError = m.storage_create_error({ name: createName });
    } finally {
      creating = false;
    }
  }

  // ── Breadcrumb label context menu (right-click to pin / unpin) ───────────
  let breadcrumbCtx = $state<({ x: number; y: number } & StorageLocation) | null>(null);

  function openBreadcrumbCtx(e: MouseEvent, b: string, p: string) {
    e.preventDefault();
    breadcrumbCtx = { x: e.clientX, y: e.clientY, bucket: b, prefix: p };
  }

  function closeBreadcrumbCtx() {
    breadcrumbCtx = null;
  }

  /** Navigate to an S3 prefix, clearing archive state first. */
  function navigateS3(prefix: string) {
    if (storage.isInArchive) {
      storage.archiveKey = null;
      storage.archivePrefix = '';
      storage.archiveNestedPath = null;
      storage.previousS3Prefix = '';
      storage.archiveLoading = false;
    }
    storage.navigate(prefix);
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
    {#if breadcrumbParts.length === 0 && !storage.isInArchive}
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
          onclick={() => {
            if (storage.isInArchive) {
              storage.exitArchive();
            } else {
              storage.navigate('');
            }
          }}
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
            dropdown-content menu rounded-box border-base-300 bg-base-100 z-30 w-48
            border p-1 shadow-lg
          "
        >
          {#each collapsedParts as part (part.prefix)}
            <li>
              <div class="group flex items-center justify-between gap-2">
                <button
                  class="flex-1 text-left text-sm hover:cursor-pointer"
                  onclick={() => navigateS3(part.prefix)}
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
      {@const isCurrent = !storage.isInArchive && i === visibleParts.length - 1}
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
            onclick={() => navigateS3(part.prefix)}
            oncontextmenu={(e) => openBreadcrumbCtx(e, storage.bucket, part.prefix)}
          >
            {part.label}
          </button>
        {/if}
        {@render pinButton(storage.bucket, part.prefix)}
      </span>
    {/each}
    {#if storage.isInArchive}
      <!-- Outer archive entry -->
      <IconChevronRight class="text-base-content/30 size-4 shrink-0" aria-hidden="true" />
      <span class="group flex shrink-0 items-center gap-1">
        <button
          class="
            text-secondary flex items-center gap-1.5 rounded-sm px-1.5
            py-0.5 font-medium transition-colors hover:cursor-pointer hover:opacity-70
          "
          title={archiveName}
          onclick={() => {
            if (storage.archiveNestedPath) {
              storage.navigateToOuterArchiveRoot();
            } else {
              storage.navigateInArchive('');
            }
          }}
        >
          <IconFolderZip class="size-4" aria-hidden="true" />
          {archiveName}
        </button>
      </span>
      <!-- Nested archive entry -->
      {#if storage.archiveNestedPath}
        <IconChevronRight class="text-base-content/30 size-4 shrink-0" aria-hidden="true" />
        <span class="group flex shrink-0 items-center gap-1">
          <button
            class="
              text-secondary flex items-center gap-1.5 rounded-sm px-1.5
              py-0.5 font-medium transition-colors hover:cursor-pointer hover:opacity-70
            "
            title={nestedArchiveName}
            onclick={() => storage.navigateInArchive('')}
          >
            <IconFolderZip class="size-4" aria-hidden="true" />
            {nestedArchiveName}
          </button>
        </span>
      {/if}
      {#each archiveParts as part (part.prefix)}
        <IconChevronRight class="text-base-content/30 size-4 shrink-0" aria-hidden="true" />
        <span class="group flex min-w-0 items-center gap-1">
          {#if part === archiveParts[archiveParts.length - 1]}
            <span
              class="
                text-base-content min-w-0 truncate rounded-sm px-1.5 py-0.5
                font-medium
              "
              title={part.label}
              aria-current="page"
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
              onclick={() => storage.navigateInArchive(part.prefix)}
            >
              {part.label}
            </button>
          {/if}
        </span>
      {/each}
    {/if}
  </nav>

  <!-- Item count badges -->
  <div class="flex shrink-0 items-center gap-1.5">
    <span
      class="tooltip tooltip-bottom badge badge-soft badge-primary badge-sm z-30 gap-1"
      data-tip={m.storage_folder_count({ count: storage.folders.length })}
    >
      <IconFolderOutline class="size-4" aria-hidden="true" />
      <span class="font-bold">{storage.folders.length}</span>
    </span>
    <span
      class="tooltip tooltip-bottom badge badge-soft badge-primary badge-sm z-30 gap-1"
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

  <!-- Create button -->
  <div class="dropdown dropdown-end inline-flex" class:dropdown-open={createOpen}>
    <button
      class="btn btn-primary btn-xs gap-1"
      onclick={openCreate}
      aria-haspopup="menu"
      aria-expanded={createOpen}
    >
      <IconAdd class="size-3.5" aria-hidden="true" />
      {m.storage_action_create()}
    </button>
    {#if createOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fixed inset-0 z-40"
        onmousedown={closeCreate}
        onkeydown={(e) => e.key === 'Escape' && closeCreate()}
      ></div>
      {#if createStep === 'choose'}
        <ul
          role="menu"
          class="
            dropdown-content menu rounded-box border-base-300 bg-base-100 z-60 w-48
            border p-1 shadow-lg
          "
        >
          <li role="none">
            <button
              role="menuitem"
              class="justify-start text-sm"
              onclick={() => selectCreateType('file')}
            >
              <IconDescriptionOutline class="size-4 shrink-0" aria-hidden="true" />
              {m.storage_create_file()}
            </button>
          </li>
          <li role="none">
            <button
              role="menuitem"
              class="justify-start text-sm"
              onclick={() => selectCreateType('folder')}
            >
              <IconFolderOutline class="size-4 shrink-0" aria-hidden="true" />
              {m.storage_create_folder()}
            </button>
          </li>
        </ul>
      {:else}
        <div
          class="
            dropdown-content rounded-box border-base-300 bg-base-100 z-60 w-64
            border p-3 shadow-lg
          "
        >
          <label for="create-name-input" class="label label-text mb-1 p-0">
            {m.storage_create_name()}
          </label>
          <input
            id="create-name-input"
            class="input input-bordered input-sm w-full"
            value={createName}
            placeholder={m.storage_create_placeholder()}
            oninput={(e) => {
              createName = sanitizeName(e.currentTarget.value);
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') closeCreate();
            }}
          />
          {#if createError}
            <p class="text-error mt-1 text-xs">{createError}</p>
          {/if}
          <div class="mt-2 flex justify-end gap-2">
            <button class="btn btn-ghost btn-xs" disabled={creating} onclick={closeCreate}>
              {m.storage_create_cancel()}
            </button>
            <button
              class="btn btn-primary btn-xs"
              disabled={creating || !createName.trim()}
              onclick={handleCreate}
            >
              {m.storage_create_confirm()}
            </button>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Upload button (hidden inside archives) -->
  {#if !storage.isInArchive}
    <button
      class="btn btn-primary btn-xs gap-1"
      onclick={() =>
        storage.openModal('upload', { bucket: storage.bucket, prefix: storage.prefix })}
    >
      <IconUpload class="size-3.5" aria-hidden="true" />
      {m.storage_action_upload()}
    </button>
  {/if}

  <!-- More options (pin current location) — hidden in archive mode -->
  {#if !storage.isInArchive}
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
        dropdown-content menu rounded-box border-base-300 bg-base-100 z-30 w-52
        border p-1 shadow-lg
      "
      >
        <li role="none">
          <button
            role="menuitem"
            class="justify-start text-sm"
            onclick={() => {
              tabsState.addTab();
              (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            <IconTab class="size-4 shrink-0" aria-hidden="true" />
            {m.storage_tab_new()}
          </button>
        </li>
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
  {/if}
</div>
