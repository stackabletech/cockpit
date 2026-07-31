<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import RecentItems from '../RecentItems.svelte';

  interface Props {
    state: StorageState;
  }

  let { state }: Props = $props();
  untrack(() => setStorageState(state));
</script>

<RecentItems />
