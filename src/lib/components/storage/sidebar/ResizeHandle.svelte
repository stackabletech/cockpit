<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { ResizablePanel } from './resizable-panel.svelte.js';

  interface Props {
    panel: ResizablePanel;
    /** Accessible label for the handle. Defaults to the storage-sidebar label. */
    label?: string;
  }

  let { panel, label }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-label={label ?? m.storage_sidebar_resize_handle()}
  aria-valuenow={panel.width}
  aria-valuemin={panel.minWidth}
  aria-valuemax={panel.maxWidth}
  tabindex="0"
  class="group focus-visible:outline-primary/50 absolute inset-y-0 -right-2 z-10 w-4 cursor-col-resize touch-none rounded-r-lg select-none focus-visible:outline-2 focus-visible:outline-offset-0"
  onpointerdown={panel.onResizeStart}
  onpointermove={panel.onResizeMove}
  onpointerup={panel.onResizeEnd}
  onpointercancel={panel.onResizeEnd}
  onkeydown={panel.onResizeKeydown}
>
  <div
    class="group-hover:bg-primary/70 absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors duration-100"
    class:bg-primary={panel.isDragging}
    class:bg-base-300={!panel.isDragging}
  ></div>
</div>
