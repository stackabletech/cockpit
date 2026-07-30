<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import { setStorageRouteBase, APP_STORAGE_ROUTES } from '$lib/storage/route-context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import BucketList from '../BucketList.svelte';

  interface Props {
    state: StorageState;
  }

  let { state }: Props = $props();
  untrack(() => {
    setStorageState(state);
    setStorageRouteBase(APP_STORAGE_ROUTES);
  });
</script>

<BucketList />
