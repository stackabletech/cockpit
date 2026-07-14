<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import StorageConnectionSidebar from '$lib/components/storage/sidebar/StorageConnectionSidebar.svelte';
  import type { ConnectionMetadata } from '$lib/server/storage/types.js';
  import { connectionStore } from '$lib/storage/connection-store.svelte.js';

  let { children } = $props();

  const connectionId = $derived(page.params.id);

  function handleSelect(conn: ConnectionMetadata) {
    goto(resolve(`/storage/connections/${conn.id}/edit`));
  }
</script>

<div class="flex flex-col gap-4 md:flex-row md:items-start">
  <StorageConnectionSidebar
    connections={connectionStore.connections}
    activeId={connectionId}
    onselect={handleSelect}
  />
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
