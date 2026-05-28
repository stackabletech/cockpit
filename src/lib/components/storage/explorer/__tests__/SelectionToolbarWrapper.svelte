<script lang="ts">
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import SelectionToolbar from '../SelectionToolbar.svelte';

  interface Props {
    state: StorageState;
  }

  let { state }: Props = $props();
  setStorageState(state);
</script>

<table>
  <thead>
    <SelectionToolbar />
  </thead>
</table>
