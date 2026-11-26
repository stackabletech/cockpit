<script lang="ts">
  import type { Snippet } from 'svelte';
  import Dropdown, { type DropdownTrigger } from './Dropdown.svelte';
  import MenuItems, { type MenuAction } from './MenuItems.svelte';
  import { menuItems } from './menu-keyboard.js';

  interface Props {
    actions: MenuAction[];
    onaction: (key: string) => void;
    /** Accessible name of the menu. */
    label: string;
    align?: 'start' | 'end';
    /** The trigger button, which gets its attributes from the snippet's argument. */
    trigger: Snippet<[DropdownTrigger]>;
  }

  let { actions, onaction, label, align = 'end', trigger }: Props = $props();

  let open = $state(false);

  function select(key: string) {
    open = false;
    onaction(key);
  }
</script>

<Dropdown
  bind:open
  {align}
  {trigger}
  class="w-48 p-1"
  onopen={(panel) => menuItems(panel)[0]?.focus()}
>
  <MenuItems {actions} onselect={select} {label} />
</Dropdown>
