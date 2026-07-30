<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconArrowBack from 'virtual:icons/material-symbols/arrow-back';
  import * as m from '$lib/paraglide/messages.js';
  import {
    loadAllConnectionsLocally,
    removeConnectionById,
    type SavedConnection
  } from '$lib/storage/connection-storage.js';
  import DeleteConnectionModal from '$lib/components/storage/DeleteConnectionModal.svelte';

  let connections = $state<SavedConnection[]>([]);
  let loaded = $state(false);
  let deleteCandidate = $state<SavedConnection | null>(null);
  let deleteModalOpen = $state(false);

  // Context menu
  let menuConn: SavedConnection | null = $state(null);
  let menuEl: HTMLUListElement | null = $state(null);
  let menuRawPos = $state({ left: 0, top: 0 });

  const menuPos = $derived.by(() => {
    if (!menuConn) return { left: 0, top: 0 };
    if (!menuEl) return menuRawPos;
    const rect = menuEl.getBoundingClientRect();
    return {
      left:
        menuRawPos.left + rect.width > window.innerWidth
          ? menuRawPos.left - rect.width
          : menuRawPos.left,
      top:
        menuRawPos.top + rect.height > window.innerHeight
          ? menuRawPos.top - rect.height
          : menuRawPos.top
    };
  });

  onMount(() => {
    connections = loadAllConnectionsLocally();
    loaded = true;
  });

  function connectionLabel(conn: SavedConnection): string {
    if (conn.name) return conn.name;
    return conn.port ? `${conn.host}:${conn.port}` : conn.host;
  }

  function openContextMenu(e: MouseEvent, conn: SavedConnection) {
    e.preventDefault();
    e.stopPropagation();
    menuRawPos = { left: e.clientX, top: e.clientY };
    menuConn = conn;
  }

  function closeContextMenu() {
    menuConn = null;
  }

  function handleOutsideClick(e: MouseEvent) {
    if (menuConn && menuEl && !menuEl.contains(e.target as Node)) closeContextMenu();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (menuConn && e.key === 'Escape') closeContextMenu();
  }

  function requestDelete(conn: SavedConnection) {
    closeContextMenu();
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

<svelte:document onclick={handleOutsideClick} />
<svelte:window onkeydown={handleKeydown} />

<div class="mx-auto max-w-4xl p-6">
  <a href={resolve('/embed/storage') + '?disconnected=1'} class="btn btn-ghost btn-sm mb-4 -ml-2">
    <IconArrowBack class="size-4" aria-hidden="true" />
    {m.storage_connections_back()}
  </a>

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
      <table class="table-sm table">
        <thead>
          <tr>
            <th>{m.storage_connections_col_name()}</th>
            <th>{m.storage_connections_col_host()}</th>
            <th>{m.storage_connections_col_type()}</th>
            <th class="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {#each connections as conn (conn.id)}
            <tr
              class="group hover:bg-base-300 cursor-default select-none"
              class:outline={menuConn?.id === conn.id}
              class:bg-base-200={menuConn?.id === conn.id}
              oncontextmenu={(e) => openContextMenu(e, conn)}
            >
              <td>
                <div class="flex items-center gap-2">
                  <IconStorage class="text-primary size-4 shrink-0" aria-hidden="true" />
                  <span class="font-medium">{connectionLabel(conn)}</span>
                </div>
              </td>
              <td class="text-base-content/60 font-mono text-xs">
                {conn.port ? `${conn.host}:${conn.port}` : conn.host}
              </td>
              <td class="text-base-content/60 text-xs uppercase">{conn.type}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100"
                  aria-label={m.storage_connections_options({ label: connectionLabel(conn) })}
                  onclick={(e) => openContextMenu(e, conn)}
                >
                  <IconMoreHoriz class="size-4" aria-hidden="true" />
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Context menu (right-click or ⋯ button) -->
{#if menuConn}
  <ul
    bind:this={menuEl}
    class="menu menu-sm border-base-300 bg-base-100 fixed z-50 w-36 rounded-lg border p-1 shadow-lg"
    role="menu"
    tabindex="-1"
    style="left: {menuPos.left}px; top: {menuPos.top}px;"
  >
    <li role="none">
      <a
        href={resolve(`/embed/storage/connections/${menuConn.id}/edit`)}
        role="menuitem"
        onclick={closeContextMenu}
      >
        <IconEdit class="size-4 shrink-0" aria-hidden="true" />
        {m.storage_connections_edit()}
      </a>
    </li>
    <li role="none">
      <button
        type="button"
        role="menuitem"
        class="text-error"
        onclick={() => requestDelete(menuConn!)}
      >
        <IconDelete class="size-4 shrink-0" aria-hidden="true" />
        {m.storage_connections_delete()}
      </button>
    </li>
  </ul>
{/if}

<DeleteConnectionModal
  bind:open={deleteModalOpen}
  connection={deleteCandidate}
  onconfirm={confirmDelete}
  oncancel={cancelDelete}
/>
