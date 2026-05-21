<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { ActionName } from '$lib/storage/types.js';

  const storage = getStorageState();

  // Position and derived state from context
  const x = $derived(storage.contextMenu?.x ?? 0);
  const y = $derived(storage.contextMenu?.y ?? 0);
  const selectionCount = $derived(storage.selectedKeys.size);
  const canPreview = $derived(
    (storage.selectedFiles.length === 1 && storage.selectedFolders.length === 0) ||
      (storage.contextMenu !== null && storage.ctxIsFile)
  );
  const canDownload = $derived(storage.selectedFiles.length > 0 || storage.ctxIsFile);

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

  const actions = $derived([
    {
      key: 'preview' as ActionName,
      icon: 'material-symbols:visibility',
      label: m.storage_action_preview(),
      disabled: !canPreview,
      hidden: false
    },
    {
      key: 'download' as ActionName,
      icon: 'material-symbols:download',
      label: m.storage_action_download(),
      disabled: !canDownload,
      hidden: false
    },
    {
      key: 'pin' as ActionName,
      icon: 'material-symbols:push-pin-outline',
      label: m.storage_action_pin(),
      disabled: !storage.canPin,
      hidden: !storage.canPin || storage.ctxIsPinned
    },
    {
      key: 'unpin' as ActionName,
      icon: 'material-symbols:push-pin',
      label: m.storage_action_unpin(),
      disabled: !storage.ctxIsPinned,
      hidden: !storage.ctxIsPinned
    }
  ]);

  const dangerActions = $derived([
    {
      key: 'delete' as ActionName,
      icon: 'material-symbols:delete',
      label: m.storage_action_delete(),
      disabled: selectionCount === 0,
      class: 'text-error'
    }
  ]);
</script>

<svelte:window onkeydown={handleKeydown} />

<ul
  bind:this={menuEl}
  class="
    menu menu-sm border-base-300 bg-base-100 absolute z-50 w-48 rounded-lg
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
        <Icon icon="mdi:close" class="size-4" aria-hidden="true" />
      </button>
    </div>
  </li>

  {#each actions as act (act.key)}
    {#if !act.hidden}
      <li role="none" class:menu-disabled={act.disabled}>
        <button
          role="menuitem"
          class="justify-start"
          onclick={() => emit(act.key)}
          disabled={act.disabled}
          aria-disabled={act.disabled}
        >
          <Icon icon={act.icon} class="mr-2 size-4 shrink-0" aria-hidden="true" />
          {act.label}
        </button>
      </li>
    {/if}
  {/each}

  {#each dangerActions as act (act.key)}
    <li role="none">
      <button
        role="menuitem"
        class={'justify-start ' + (act.class ?? '')}
        onclick={() => emit(act.key)}
        disabled={act.disabled}
      >
        <Icon
          icon={act.icon}
          class={'mr-2 h-4 w-4 shrink-0 ' + (act.class ?? '')}
          aria-hidden="true"
        />
        {act.label}
      </button>
    </li>
  {/each}
</ul>
