<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import FileRow from '../FileRow.svelte';

  interface Props {
    state: StorageState;
    file: StorageObject;
  }

  let { state, file }: Props = $props();
  untrack(() => setStorageState(state));
</script>

<table>
  <tbody>
    <FileRow {file} />
  </tbody>
</table>
