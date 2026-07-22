<script lang="ts">
  import { onMount } from 'svelte';
  import type { Component } from 'svelte';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconVisibility from 'virtual:icons/material-symbols/visibility';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import IconPushPinOutline from 'virtual:icons/material-symbols/push-pin-outline';
  import IconPushPin from 'virtual:icons/material-symbols/push-pin';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import IconContentCopy from 'virtual:icons/material-symbols/content-copy';
  import IconFileCopy from 'virtual:icons/material-symbols/file-copy-outline';
  import IconCut from 'virtual:icons/material-symbols/content-cut';
  import IconCopy from 'virtual:icons/material-symbols/content-copy';
  import IconPaste from 'virtual:icons/material-symbols/content-paste';
  import IconDriveFileRenameOutline from 'virtual:icons/material-symbols/drive-file-rename-outline';
  import IconDescriptionOutline from 'virtual:icons/material-symbols/description-outline';
  import IconFolderOutline from 'virtual:icons/material-symbols/folder-outline';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { ActionName } from '$lib/storage/types.js';
  import {
    storageCutCopyEnabled,
    storagePasteEnabled,
    storageRenameEnabled
  } from '$lib/client/feature-flags.js';

  const storage = getStorageState();

  // Position and derived state from context
  const x = $derived(storage.contextMenu?.x ?? 0);
  const y = $derived(storage.contextMenu?.y ?? 0);
  const selectionCount = $derived(storage.selectedKeys.size);
  const hasCtxKey = $derived(!!storage.contextMenu?.key);
  const canPreview = $derived(
    (storage.selectedFiles.length === 1 && storage.selectedFolders.length === 0) ||
      (storage.contextMenu !== null && storage.ctxIsFile)
  );
  const canDownload = $derived(storage.selectedFiles.length > 0 || storage.ctxIsFile);
  const canShowDetails = $derived(
    storage.contextMenu !== null ||
      (storage.selectedFiles.length === 1 && storage.selectedFolders.length === 0)
  );

  let menuEl = $state<HTMLUListElement | null>(null);

  // Adjust position so menu stays within viewport
  const adjustedPos = $derived.by(() => {
    if (!menuEl) return { left: x, top: y };
    const rect = menuEl.getBoundingClientRect();
    return {
      left: x + rect.width > window.innerWidth ? x - rect.width : x,
      top: y + rect.height > window.innerHeight ? y - rect.height : y
    };
  });

  function emit(action: string) {
    storage.executeAction(action as ActionName);
    storage.contextMenu = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') storage.closeContextMenu();
  }

  function handleOutsideClick(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) storage.closeContextMenu();
  }

  onMount(() => {
    menuEl?.focus();
    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true);
  });

  const actions = $derived.by<
    Array<{
      key: ActionName;
      icon: Component;
      label: string;
      disabled: boolean;
      hidden: boolean;
      class?: string;
    }>
  >(() => {
    const items: Array<{
      key: ActionName;
      icon: Component;
      label: string;
      disabled: boolean;
      hidden: boolean;
      class?: string;
    }> = [];

    // Empty-space: show create options and paste
    if (!hasCtxKey) {
      items.push(
        {
          key: 'create-file' as ActionName,
          icon: IconDescriptionOutline as Component,
          label: m.storage_create_file(),
          disabled: false,
          hidden: storage.archive.isInArchive
        },
        {
          key: 'create-folder' as ActionName,
          icon: IconFolderOutline as Component,
          label: m.storage_create_folder(),
          disabled: false,
          hidden: storage.archive.isInArchive
        },
        {
          key: 'paste' as ActionName,
          icon: IconPaste as Component,
          label: m.storage_action_paste(),
          disabled: storage.clipboard === null || storage.archive.isInArchive,
          hidden: !storagePasteEnabled || storage.archive.isInArchive
        }
      );
      return items;
    }

    // Item-specific actions
    items.push(
      {
        key: 'preview' as ActionName,
        icon: IconVisibility as Component,
        label: m.storage_action_preview(),
        disabled: !canPreview,
        hidden: false
      },
      {
        key: 'download' as ActionName,
        icon: IconDownload as Component,
        label: m.storage_action_download(),
        disabled: !canDownload,
        hidden: false
      },
      {
        key: 'details' as ActionName,
        icon: IconInfo as Component,
        label: m.storage_action_details(),
        disabled: !canShowDetails,
        hidden: false
      },
      {
        key: 'cut' as ActionName,
        icon: IconCut as Component,
        label: m.storage_action_cut(),
        disabled: selectionCount === 0 || storage.archive.isInArchive,
        hidden: !storageCutCopyEnabled || storage.archive.isInArchive
      },
      {
        key: 'copy' as ActionName,
        icon: IconCopy as Component,
        label: m.storage_action_copy(),
        disabled: selectionCount === 0 || storage.archive.isInArchive,
        hidden: !storageCutCopyEnabled || storage.archive.isInArchive
      },
      {
        key: 'paste' as ActionName,
        icon: IconPaste as Component,
        label: m.storage_action_paste(),
        disabled: storage.clipboard === null || storage.archive.isInArchive,
        hidden: !storagePasteEnabled || storage.archive.isInArchive
      },
      {
        key: 'rename' as ActionName,
        icon: IconDriveFileRenameOutline as Component,
        label: m.storage_action_rename(),
        disabled: selectionCount !== 1 || storage.archive.isInArchive,
        hidden: !storageRenameEnabled || storage.archive.isInArchive
      },
      {
        key: 'copy-filename' as ActionName,
        icon: IconFileCopy as Component,
        label: m.storage_action_copy_filename(),
        disabled: !hasCtxKey,
        hidden: false
      },
      {
        key: 'copy-path' as ActionName,
        icon: IconContentCopy as Component,
        label: m.storage_action_copy_path(),
        disabled: !hasCtxKey,
        hidden: false
      },
      {
        key: 'pin' as ActionName,
        icon: IconPushPinOutline as Component,
        label: m.storage_action_pin(),
        disabled: !storage.canPin || storage.archive.isInArchive,
        hidden: !storage.canPin || storage.ctxIsPinned || storage.archive.isInArchive
      },
      {
        key: 'unpin' as ActionName,
        icon: IconPushPin as Component,
        label: m.storage_action_unpin(),
        disabled: !storage.ctxIsPinned || storage.archive.isInArchive,
        hidden: !storage.ctxIsPinned || storage.archive.isInArchive
      }
    );

    return items;
  });

  const dangerActions = $derived(
    storage.archive.isInArchive || !hasCtxKey
      ? []
      : [
          {
            key: 'delete' as ActionName,
            icon: IconDelete as Component,
            label: m.storage_action_delete(),
            disabled: selectionCount === 0,
            class: 'text-error'
          }
        ]
  );
</script>

<svelte:window onkeydown={handleKeydown} />

<ul
  bind:this={menuEl}
  class="
    menu menu-sm border-base-300 bg-base-100 fixed z-70 w-48 rounded-lg
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
        aria-label="Close"
        onclick={() => storage.closeContextMenu()}
      >
        <IconClose class="size-4" aria-hidden="true" />
      </button>
    </div>
  </li>

  {#each actions as act (act.key)}
    {#if !act.hidden}
      {@const ActIcon = act.icon}
      <li role="none" class:menu-disabled={act.disabled}>
        <button
          role="menuitem"
          class="justify-start"
          onclick={() => emit(act.key)}
          disabled={act.disabled}
          aria-disabled={act.disabled}
        >
          <ActIcon class="mr-2 size-4 shrink-0" aria-hidden="true" />
          {act.label}
        </button>
      </li>
    {/if}
  {/each}

  {#each dangerActions as act (act.key)}
    {@const ActIcon = act.icon}
    <li role="none">
      <button
        role="menuitem"
        class={'justify-start ' + (act.class ?? '')}
        onclick={() => emit(act.key)}
        disabled={act.disabled}
      >
        <ActIcon class={'mr-2 h-4 w-4 shrink-0 ' + (act.class ?? '')} aria-hidden="true" />
        {act.label}
      </button>
    </li>
  {/each}
</ul>
