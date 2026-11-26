<script lang="ts">
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte';
  import type { MenuAction } from '$lib/components/ui/MenuItems.svelte';

  let { onaction }: { onaction: (key: string) => void } = $props();

  const actions: MenuAction[] = [
    { key: 'edit', icon: IconEdit, label: 'Edit' },
    { key: 'locked', icon: IconDelete, label: 'Locked', disabled: true },
    { key: 'secret', icon: IconDelete, label: 'Secret', hidden: true },
    { key: 'delete', icon: IconDelete, label: 'Delete', class: 'text-error' }
  ];
</script>

<DropdownMenu {actions} {onaction} label="Options">
  {#snippet trigger(dropdown)}
    <button {...dropdown} type="button">Trigger</button>
  {/snippet}
</DropdownMenu>
<button type="button">After</button>
