<script lang="ts">
  import IconClose from 'virtual:icons/material-symbols/close';
  import * as m from '$lib/paraglide/messages.js';
  import type { ContextMenuAction } from '$lib/storage/types.js';

  interface Props {
    actions: ContextMenuAction[];
    onaction: (key: string) => void;
    x: number;
    y: number;
    onclose: () => void;
    open: boolean;
    title?: string;
  }

  let { actions, onaction, x, y, onclose, open: isOpen, title }: Props = $props();

  function emit(key: string) {
    onaction(key);
  }

  function close() {
    onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) close();
  }

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

  $effect(() => {
    if (isOpen) menuEl?.focus();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div
    class="fixed inset-0 z-40"
    aria-hidden="true"
    onmousedown={handleBackdropClick}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></div>

  <ul
    bind:this={menuEl}
    class="menu menu-sm border-base-300 bg-base-100 fixed z-60 w-48 rounded-lg border p-1 shadow-lg"
    role="menu"
    tabindex="-1"
    aria-label={title}
    style="left: {adjustedPos.left}px; top: {adjustedPos.top}px;"
  >
    {#if title}
      <li class="menu-title p-0" role="none">
        <div class="menu-title flex items-center justify-between py-1 pr-0 pl-2">
          <span class="text-base-content/70 text-xs font-medium">{title}</span>
          <div class="tooltip tooltip-left" data-tip={m.action_close()}>
            <button
              type="button"
              role="menuitem"
              class="btn btn-ghost btn-xs"
              aria-label={m.action_close()}
              onclick={close}
            >
              <IconClose class="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </li>
    {/if}

    {#each actions as act (act.key)}
      {#if !act.hidden}
        {@const ActIcon = act.icon}
        <li role="none" class:menu-disabled={act.disabled}>
          <button
            role="menuitem"
            class={'justify-start ' + (act.class ?? '')}
            onclick={() => {
              emit(act.key);
              close();
            }}
            disabled={act.disabled}
            aria-disabled={act.disabled}
          >
            <ActIcon class={'mr-2 size-4 shrink-0 ' + (act.class ?? '')} aria-hidden="true" />
            {act.label}
          </button>
        </li>
      {/if}
    {/each}
  </ul>
{/if}
