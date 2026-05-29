<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import FolderRow from '../FolderRow.svelte';

  interface Props {
    state: StorageState;
    folder: StorageObject;
  }

  let { state, folder }: Props = $props();
  untrack(() => setStorageState(state));
</script>

<table>
  <tbody>
    <FolderRow {folder} />
  </tbody>
</table>
