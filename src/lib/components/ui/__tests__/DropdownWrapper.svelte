<script lang="ts">
  import Dropdown from '$lib/components/ui/Dropdown.svelte';

  interface Props {
    popup?: 'menu' | 'dialog';
    label?: string;
    onopen?: (panel: HTMLElement) => void;
  }
  let { popup = 'dialog', label = 'Panel', onopen }: Props = $props();

  const uid = $props.id();
  let open = $state(false);
</script>

<button type="button">Outside</button>
<p>Open: {open}</p>
<Dropdown bind:open {popup} {label} {onopen} align="end">
  {#snippet trigger(dropdown)}
    <button {...dropdown} type="button">Trigger</button>
  {/snippet}
  <label for="{uid}-field">Field</label>
  <input id="{uid}-field" />
  <button type="button" onclick={() => (open = false)}>Done</button>
</Dropdown>
