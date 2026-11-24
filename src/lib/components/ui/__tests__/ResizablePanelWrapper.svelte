<script lang="ts">
  import ResizeHandle from '$lib/components/ui/ResizeHandle.svelte';
  import { createResizablePanel } from '$lib/components/ui/resizable-panel.svelte.js';

  interface Props {
    id: string;
    label: string;
  }

  let { id, label }: Props = $props();

  // svelte-ignore state_referenced_locally
  const panel = createResizablePanel({ id, defaultWidth: 200, minWidth: 150, maxWidth: 300 });
</script>

<div class="relative h-10" style="width: {panel.cssWidth}" data-testid="panel-{id}">
  <ResizeHandle {panel} {label} />
</div>
