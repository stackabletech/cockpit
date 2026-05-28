<script lang="ts">
  import { setStorageState } from '$lib/storage/context.js';
  import type { StorageState } from '$lib/storage/state.svelte.js';
  import type { Snippet } from 'svelte';

  interface Props {
    state: StorageState;
    children: Snippet;
  }

  let { state, children }: Props = $props();
  setStorageState(state);
</script>

{@render children()}
