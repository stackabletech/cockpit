<script lang="ts" module>
  import type { Component } from 'svelte';

  export interface MenuAction {
    key: string;
    icon: Component;
    label: string;
    disabled?: boolean;
    hidden?: boolean;
    /** Extra classes for the item and its icon, e.g. `text-error` for destructive actions. */
    class?: string;
    /** Renders the item as a link (resolved by the caller) instead of a button. */
    href?: string;
  }
</script>

<script lang="ts">
  import { handleMenuKeydown } from './menu-keyboard.js';

  interface Props {
    actions: MenuAction[];
    /** Called with the action's key when an item is chosen. */
    onselect: (key: string) => void;
    label?: string;
  }

  let { actions, onselect, label }: Props = $props();
</script>

<!-- The items are no Tab stops: the arrow keys move between them and Tab leaves the menu. -->
<ul
  class="menu menu-sm w-full p-0"
  role="menu"
  tabindex="-1"
  aria-label={label}
  onkeydown={(e) => handleMenuKeydown(e, e.currentTarget)}
>
  {#each actions as act (act.key)}
    {#if !act.hidden}
      {@const ActIcon = act.icon}
      <li role="none" class:menu-disabled={act.disabled}>
        {#if act.href}
          <!-- eslint-disable svelte/no-navigation-without-resolve -- callers pass resolved hrefs -->
          <a
            role="menuitem"
            tabindex="-1"
            href={act.href}
            class={act.class}
            onclick={() => onselect(act.key)}
          >
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
            <ActIcon class="mr-2 size-4 shrink-0" aria-hidden="true" />
            {act.label}
          </a>
        {:else}
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class={'justify-start ' + (act.class ?? '')}
            onclick={() => onselect(act.key)}
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
