<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ContextMenuAction } from './ContextMenu.svelte';

  interface Props {
    actions: ContextMenuAction[];
    onaction: (key: string) => void;
    /** Called on Tab: focus leaves the menu, so it closes. */
    ondismiss: () => void;
    label?: string;
    /** Rows above the actions, e.g. a title. Their menu items join the arrow-key navigation. */
    header?: Snippet;
    element?: HTMLUListElement;
    /** Lets the menu itself take focus, e.g. when it opens without a focused item. */
    focusable?: boolean;
  }

  let {
    actions,
    onaction,
    ondismiss,
    label,
    header,
    element = $bindable(),
    focusable = false
  }: Props = $props();

  function menuItems(): HTMLElement[] {
    return [...(element?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  }

  /** The menu keyboard pattern: arrows and Home/End move, Tab leaves and closes. */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      ondismiss();
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

  /** Focuses the first enabled item. */
  export function focusFirst() {
    menuItems()[0]?.focus();
  }
</script>

<ul
  bind:this={element}
  class="menu menu-sm w-full p-0"
  role="menu"
  tabindex={focusable ? -1 : undefined}
  aria-label={label}
  onkeydown={handleKeydown}
>
  {@render header?.()}

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
            onclick={() => onaction(act.key)}
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
            onclick={() => onaction(act.key)}
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
