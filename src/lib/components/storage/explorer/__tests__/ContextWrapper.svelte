<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import { setStorageRouteBase, APP_STORAGE_ROUTES } from '$lib/storage/route-context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import type { Snippet } from 'svelte';

  interface Props {
    state: StorageState;
    children: Snippet;
  }

  let { state, children }: Props = $props();
  untrack(() => {
    setStorageState(state);
    setStorageRouteBase(APP_STORAGE_ROUTES);
  });
</script>

{@render children()}
