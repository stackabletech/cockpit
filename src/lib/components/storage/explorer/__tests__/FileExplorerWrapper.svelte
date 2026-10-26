<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState, setTabsState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import { TabsState } from '$lib/storage/tabs.svelte.js';
  import FileExplorer from '../FileExplorer.svelte';

  interface Props {
    state: StorageState;
    tabs?: TabsState;
  }

  let { state, tabs }: Props = $props();
  untrack(() => {
    setStorageState(state);
    setTabsState(tabs ?? new TabsState(state));
  });
</script>

<FileExplorer />
