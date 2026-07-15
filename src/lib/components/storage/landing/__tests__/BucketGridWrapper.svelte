<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import BucketGrid from '../BucketGrid.svelte';

  interface Props {
    state: StorageState;
    buckets?: string[];
  }

  let { state, buckets = [] }: Props = $props();
  untrack(() => setStorageState(state));
</script>

<BucketGrid {buckets} />
