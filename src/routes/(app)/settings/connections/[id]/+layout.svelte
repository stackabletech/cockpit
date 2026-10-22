<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import StorageConnectionSidebar from '$lib/components/storage/sidebar/StorageConnectionSidebar.svelte';
  import type { ConnectionMetadata } from '$lib/storage/connection-types.js';
  import { connectionStore } from '$lib/storage/connection-store.svelte.js';
  import { setConnectionEditGuard, type ConnectionEditGuard } from '$lib/storage/context.js';

  let { children } = $props();

  const connectionId = $derived(page.params.id);

  // The edit page registers its unsaved-changes check here.
  const editGuard: ConnectionEditGuard = { confirmDiscard: null, restoreChanges: null };
  setConnectionEditGuard(editGuard);

  function handleSelect(conn: ConnectionMetadata) {
    goto(resolve(`/settings/connections/${conn.id}/edit`));
  }

  // Only /storage fills the store, so drop deleted connections here.
  function handleDeleteSettled(connectionId: string, deleted: boolean) {
    if (deleted) {
      connectionStore.connections = connectionStore.connections.filter(
        (c) => c.id !== connectionId
      );
    } else {
      editGuard.restoreChanges?.();
    }
  }
</script>

<div class="flex flex-col gap-4 md:flex-row md:items-start">
  <StorageConnectionSidebar
    connections={connectionStore.connections}
    activeId={connectionId}
    onselect={handleSelect}
    onbeforedelete={() => editGuard.confirmDiscard?.() ?? Promise.resolve(true)}
    ondeletesettled={handleDeleteSettled}
  />
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
