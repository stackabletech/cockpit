<script lang="ts">
  import { untrack } from 'svelte';
  import type { ComponentProps } from 'svelte';
  import { setStorageRouteBase, APP_STORAGE_ROUTES } from '$lib/storage/route-context.js';
  import StorageConnectForm from '../StorageConnectForm.svelte';

  let { connectionForm }: ComponentProps<typeof StorageConnectForm> = $props();
  untrack(() => setStorageRouteBase(APP_STORAGE_ROUTES));
</script>

<StorageConnectForm {connectionForm} />
