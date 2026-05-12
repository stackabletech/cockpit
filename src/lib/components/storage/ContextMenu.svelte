<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    x: number;
    y: number;
    selectionCount: number;
    canPreview: boolean;
    canDownload: boolean;
    onaction: (action: string) => void;
    onclose: () => void;
  }

  let { x, y, selectionCount, canPreview, canDownload, onaction, onclose }: Props = $props();

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
    onaction(action);
    onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function handleOutsideClick(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) onclose();
  }

  onMount(() => {
    menuEl?.focus();
    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true);
  });

  const actions = [
    {
      key: 'preview',
      icon: 'material-symbols:visibility',
      label: () => m.storage_action_preview(),
      disabled: () => !canPreview
    },
    {
      key: 'rename',
      icon: 'material-symbols:edit',
      label: () => m.storage_action_rename(),
      disabled: () => selectionCount !== 1
    },
    {
      key: 'download',
      icon: 'material-symbols:download',
      label: () => m.storage_action_download(),
      disabled: () => !canDownload
    },
    {
      key: 'move',
      icon: 'material-symbols:drive-file-move',
      label: () => m.storage_action_move(),
      disabled: () => selectionCount === 0
    }
  ];

  const dangerActions = [
    {
      key: 'delete',
      icon: 'material-symbols:delete',
      label: () => m.storage_action_delete(),
      disabled: () => selectionCount === 0,
      class: 'text-error'
    }
  ];
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
    <div class="menu-title flex items-center justify-between py-1 pl-2 pr-0">
      <span class="text-base-content/70 text-xs font-medium">
        {m.storage_context_menu_actions()}
      </span>

      <button
        type="button"
        role="menuitem"
        class="btn btn-ghost btn-xs"
        aria-label="Close"
        onclick={onclose}
      >
        <Icon icon="mdi:close" class="size-4" aria-hidden="true" />
      </button>
    </div>
  </li>

  {#each actions as act (act.key)}
    {@const disabled = act.disabled()}
    <li role="none" class:menu-disabled={disabled}>
      <button
        role="menuitem"
        class="justify-start"
        onclick={() => emit(act.key)}
        {disabled}
        aria-disabled={disabled}
      >
        <Icon icon={act.icon} class="mr-2 size-4 shrink-0" aria-hidden="true" />
        {act.label()}
      </button>
    </li>
  {/each}

  {#each dangerActions as act (act.key)}
    <li role="none">
      <button
        role="menuitem"
        class={'justify-start ' + (act.class ?? '')}
        onclick={() => emit(act.key)}
        disabled={act.disabled()}
      >
        <Icon
          icon={act.icon}
          class={'mr-2 h-4 w-4 shrink-0 ' + (act.class ?? '')}
          aria-hidden="true"
        />
        {act.label()}
      </button>
    </li>
  {/each}
</ul>
