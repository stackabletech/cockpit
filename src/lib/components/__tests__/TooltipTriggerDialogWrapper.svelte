<script lang="ts">
  import Modal from '../Modal.svelte';
  import TooltipTrigger from '../TooltipTrigger.svelte';

  interface Props {
    text: string | null;
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
