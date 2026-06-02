<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import { setTabsState } from '$lib/storage/tabs-context.js';
  import { TabsState } from '$lib/storage/tabs.svelte.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import StorageBreadcrumb from '../StorageBreadcrumb.svelte';

  interface Props {
    state: StorageState;
    tabsState?: TabsState;
  }

  let { state, tabsState: tabsStateProp }: Props = $props();
  const effectiveTabsState = tabsStateProp ?? new TabsState(state);
  untrack(() => {
    setStorageState(state);
    setTabsState(effectiveTabsState);
  });
</script>

<StorageBreadcrumb />
