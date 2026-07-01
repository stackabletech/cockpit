<script lang="ts">
  import { onMount } from 'svelte';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import * as m from '$lib/paraglide/messages.js';
  import {
    loadAllConnectionsLocally,
    removeConnectionById,
    type SavedConnection
  } from '$lib/storage/connection-storage.js';
  import Modal from '$lib/components/Modal.svelte';

  let connections = $state<SavedConnection[]>([]);
  let loaded = $state(false);
  let deleteCandidate = $state<SavedConnection | null>(null);
  let deleteModalOpen = $state(false);

  onMount(() => {
    connections = loadAllConnectionsLocally();
    loaded = true;
  });

  function connectionLabel(conn: SavedConnection): string {
    if (conn.name) return conn.name;
    if (conn.endpoint) {
      try {
        return new URL(conn.endpoint).hostname;
      } catch {
        return conn.endpoint;
      }
    }
    return 'AWS S3';
  }

  function requestDelete(conn: SavedConnection) {
    deleteCandidate = conn;
    deleteModalOpen = true;
  }

  function confirmDelete() {
    if (!deleteCandidate) return;
    removeConnectionById(deleteCandidate.id);
    connections = loadAllConnectionsLocally();
    deleteModalOpen = false;
    deleteCandidate = null;
  }

  function cancelDelete() {
    deleteModalOpen = false;
    deleteCandidate = null;
  }
</script>

<div class="mx-auto max-w-4xl p-6">
  <h1 class="mb-1 text-xl font-semibold">{m.storage_connections_title()}</h1>
  <p class="text-base-content/60 mb-6 text-sm">{m.storage_connections_subtitle()}</p>

  {#if !loaded}
    <div class="flex items-center justify-center py-12">
      <span class="loading loading-spinner loading-md text-base-content/40"></span>
    </div>
  {:else if connections.length === 0}
    <p class="text-base-content/50 text-sm">{m.storage_connections_empty()}</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Connection</th>
            <th>Endpoint</th>
            <th>Type</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each connections as conn (conn.id)}
            <tr>
              <td>
                <div class="flex items-center gap-2">
                  <IconStorage class="text-primary size-5 shrink-0" aria-hidden="true" />
                  <span class="font-medium">{connectionLabel(conn)}</span>
                </div>
              </td>
              <td class="text-base-content/60 text-sm">
                {conn.endpoint || 'AWS S3'}
              </td>
              <td class="text-base-content/60 text-sm uppercase">{conn.type}</td>
              <td class="text-right">
                <div class="flex justify-end gap-1">
                  <a
                    href="/storage/connections/{conn.id}/edit"
                    class="btn btn-ghost btn-sm"
                    aria-label="{m.storage_connections_edit()} {connectionLabel(conn)}"
                  >
                    <IconEdit class="size-4" aria-hidden="true" />
                    {m.storage_connections_edit()}
                  </a>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm text-error"
                    aria-label="{m.storage_connections_delete()} {connectionLabel(conn)}"
                    onclick={() => requestDelete(conn)}
                  >
                    <IconDelete class="size-4" aria-hidden="true" />
                    {m.storage_connections_delete()}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="mt-6">
    <a href="/storage?disconnected=1" class="btn btn-ghost btn-sm">← {m.storage_connect_title()}</a>
  </div>
</div>

<Modal bind:open={deleteModalOpen} class="modal">
  <div class="modal-box">
    <p class="text-base-content font-medium">
      {m.storage_connections_delete_confirm({
        label: deleteCandidate ? connectionLabel(deleteCandidate) : ''
      })}
    </p>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost btn-sm" onclick={cancelDelete}>
        {m.storage_connections_delete_cancel()}
      </button>
      <button type="button" class="btn btn-error btn-sm" onclick={confirmDelete}>
        {m.storage_connections_delete_confirm_button()}
      </button>
    </div>
  </div>
</Modal>
