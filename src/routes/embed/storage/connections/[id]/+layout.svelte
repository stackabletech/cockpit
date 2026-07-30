<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import StorageConnectionSidebar from '$lib/components/storage/sidebar/StorageConnectionSidebar.svelte';
  import type { SavedConnection } from '$lib/storage/connection-storage.js';

  let { children } = $props();

  const connectionId = $derived(page.params.id);

  function handleSelect(conn: SavedConnection) {
    goto(resolve(`/embed/storage/connections/${conn.id}/edit`));
  }
</script>

<div class="flex flex-col gap-4 md:flex-row md:items-start">
  <StorageConnectionSidebar activeId={connectionId} onselect={handleSelect} />
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
