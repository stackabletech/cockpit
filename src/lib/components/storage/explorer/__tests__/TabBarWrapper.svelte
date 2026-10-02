<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import { setTabsState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import type { TabsState } from '$lib/storage/tabs.svelte.js';
  import TabBar from '../TabBar.svelte';

  interface Props {
    storage: StorageState;
    tabsState: TabsState;
  }

  let { storage, tabsState }: Props = $props();
  untrack(() => {
    setStorageState(storage);
    setTabsState(tabsState);
  });
</script>

<TabBar {tabsState} />
