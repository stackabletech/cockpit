<script lang="ts">
  import TooltipTrigger from '../TooltipTrigger.svelte';

  interface Props {
    text: string | null;
    orientation?: 'right' | 'left' | 'up' | 'down';
  }
  let { text, orientation = 'down' }: Props = $props();
</script>

<TooltipTrigger {text} {orientation}>
  <button type="button">Trigger</button>
</TooltipTrigger>
