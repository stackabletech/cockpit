<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import TooltipTrigger from '$lib/components/ui/TooltipTrigger.svelte';

  interface Props {
    text?: string;
    orientation?: 'right' | 'left' | 'up' | 'down';
  }
  let { text, orientation = 'down' }: Props = $props();

  let open = $state(true);
</script>

<Modal bind:open>
  <TooltipTrigger {text} {orientation}>
    <button type="button">Trigger</button>
  </TooltipTrigger>
</Modal>
