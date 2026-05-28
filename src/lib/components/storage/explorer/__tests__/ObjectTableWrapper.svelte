<script lang="ts">
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import ObjectTable from '../ObjectTable.svelte';

  interface Props {
    state: StorageState;
  }

  let { state }: Props = $props();
  setStorageState(state);
</script>

<ObjectTable />
