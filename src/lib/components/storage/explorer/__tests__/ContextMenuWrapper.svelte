<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import ContextMenu from '../ContextMenu.svelte';

  interface Props {
    state: StorageState;
    title?: string;
  }

  let { state, title }: Props = $props();
  untrack(() => setStorageState(state));
</script>

<ContextMenu {title} />
