<script lang="ts">
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import StorageBreadcrumb from '../StorageBreadcrumb.svelte';

  interface Props {
    state: StorageState;
  }

  let { state }: Props = $props();
  setStorageState(state);
</script>

<StorageBreadcrumb />
