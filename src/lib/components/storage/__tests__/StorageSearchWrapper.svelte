<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import StorageSearch from '../StorageSearch.svelte';

  interface Props {
    state: StorageState;
    currentBucket?: string;
  }

  let { state, currentBucket }: Props = $props();
  untrack(() => setStorageState(state));
</script>

<StorageSearch {currentBucket} />
