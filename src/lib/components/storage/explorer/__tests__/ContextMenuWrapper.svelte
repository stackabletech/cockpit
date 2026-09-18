<script lang="ts">
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import type { ContextMenuAction } from '$lib/storage/types.js';
  import IconVisibility from 'virtual:icons/material-symbols/visibility';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import ContextMenu from '../ContextMenu.svelte';

  interface Props {
    state: StorageState;
    title?: string;
  }

  let { state, title }: Props = $props();
  const actions = $derived<ContextMenuAction[]>([
    {
      key: 'preview',
      icon: IconVisibility,
      label: 'Preview',
      disabled: !state.ctxIsFile,
      hidden: false
    },
    {
      key: 'download',
      icon: IconDownload,
      label: 'Download',
      disabled: state.selectedFiles.length === 0,
      hidden: false
    },
    {
      key: 'delete',
      icon: IconDelete,
      label: 'Delete',
      disabled: state.selectedKeys.size === 0,
      hidden: false,
      class: 'text-error'
    }
  ]);

  const contextMenu = $derived(state.contextMenu);
</script>

<ContextMenu
  x={contextMenu?.x ?? 0}
  y={contextMenu?.y ?? 0}
  open={contextMenu !== null}
  onclose={() => state.closeContextMenu()}
  onaction={(key) => state.executeAction(key as 'preview' | 'download' | 'delete')}
  {actions}
  {title}
/>
