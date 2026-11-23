<script lang="ts">
  import type { Component } from 'svelte';
  import { supportsAnchorPositioning, trackPopover } from './popover-position.js';
  import type { ContextMenuAction } from './ContextMenu.svelte';
  import TooltipTrigger, { type TooltipOrientation } from './TooltipTrigger.svelte';

  interface Props {
    /** Accessible name of the trigger button, also shown as its tooltip. */
    label: string;
    icon: Component;
    actions: ContextMenuAction[];
    onaction: (key: string) => void;
    /** Extra classes for the trigger button. `aria-expanded:` variants apply while the menu is open. */
    triggerClass?: string;
    iconClass?: string;
    tooltip?: TooltipOrientation;
  }

  let {
    label,
    icon: TriggerIcon,
    actions,
    onaction,
    triggerClass = '',
    iconClass = 'size-4',
    tooltip = 'right'
  }: Props = $props();

  const uid = $props.id();
  const popoverId = `${uid}-menu`;
  const anchorName = `--dropdown-menu-${uid}`;

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement>();
  let popoverEl = $state<HTMLDivElement>();

  $effect(() => {
    if (open && triggerEl && popoverEl && !supportsAnchorPositioning())
      return trackPopover(triggerEl, popoverEl, { align: 'end' });
  });

  function menuItems(): HTMLElement[] {
    return [
      ...(popoverEl?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    ];
  }

  function handleToggle(e: ToggleEvent) {
    open = e.newState === 'open';
    if (open) {
      menuItems()[0]?.focus();
      return;
    }
    // The browser only returns focus to an element that had it: Firefox and Safari on macOS
    // don't focus buttons on click. A click on another control keeps focus there.
    const active = document.activeElement;
    if (!active || active === document.body || popoverEl?.contains(active)) triggerEl?.focus();
  }

  /** The menu button keyboard pattern: arrows and Home/End move, Tab leaves and closes. */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      popoverEl?.hidePopover();
      return;
    }
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = index >= last ? 0 : index + 1;
    else if (e.key === 'ArrowUp') next = index <= 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  }

  function run(key: string) {
    popoverEl?.hidePopover();
    onaction(key);
  }
</script>

<TooltipTrigger text={label} orientation={tooltip}>
  <button
    bind:this={triggerEl}
    type="button"
    class={triggerClass}
    style={`anchor-name:${anchorName}`}
    popovertarget={popoverId}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={popoverId}
  >
    <TriggerIcon class={iconClass} aria-hidden="true" />
  </button>
</TooltipTrigger>

<!--
  The popover is a wrapper: a display class such as DaisyUI's `menu` on the popover itself would
  override the browser's `display: none` for a closed popover.
-->
<div
  bind:this={popoverEl}
  id={popoverId}
  popover="auto"
  class="dropdown dropdown-end border-base-300 bg-base-100 text-base-content w-48 rounded-lg border p-1 shadow-lg"
  style={`position-anchor:${anchorName};position-try-fallbacks:flip-block,flip-inline,flip-block flip-inline`}
  ontoggle={handleToggle}
>
  <ul class="menu menu-sm w-full p-0" role="menu" aria-label={label} onkeydown={handleKeydown}>
    {#each actions as act (act.key)}
      {#if !act.hidden}
        {@const ActIcon = act.icon}
        <li role="none" class:menu-disabled={act.disabled}>
          {#if act.href}
            <a
              role="menuitem"
              tabindex="-1"
              href={act.href}
              class={act.class}
              onclick={() => run(act.key)}
            >
              <ActIcon class="mr-2 size-4 shrink-0" aria-hidden="true" />
              {act.label}
            </a>
          {:else}
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class={'justify-start ' + (act.class ?? '')}
              onclick={() => run(act.key)}
              disabled={act.disabled}
            >
              <ActIcon class={'mr-2 size-4 shrink-0 ' + (act.class ?? '')} aria-hidden="true" />
              {act.label}
            </button>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
</div>
