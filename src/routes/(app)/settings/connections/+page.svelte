<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconArrowBack from 'virtual:icons/material-symbols/arrow-back';
  import * as m from '$lib/paraglide/messages.js';
  import type { ConnectionListItem } from '$lib/storage/connection-store.svelte.js';
  import { connectionLabel } from '$lib/storage/display-helpers.js';
  import ContextMenu, { type ContextMenuAction } from '$lib/components/ui/ContextMenu.svelte';
  import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte';
  import DeleteConnectionModal from '$lib/components/storage/modals/DeleteConnectionModal.svelte';
  import type { SavedConnection } from '$lib/storage/connection-id-header.js';

  const connections = $derived<ConnectionListItem[]>(page.data.connections ?? []);
  const deleteError = $derived((page.form as { error?: string } | null)?.error ?? null);

  // Context menu state
  let menuConn: ConnectionListItem | null = $state(null);
  let menuPos = $state({ x: 0, y: 0 });

  function openContextMenu(e: MouseEvent, conn: ConnectionListItem) {
    e.preventDefault();
    menuPos = { x: e.clientX, y: e.clientY };
    menuConn = conn;
  }

  function closeContextMenu() {
    menuConn = null;
  }

  function actionsFor(conn: ConnectionListItem): ContextMenuAction[] {
    return [
      {
        key: 'edit',
        icon: IconEdit,
        label: m.storage_connections_edit(),
        href: resolve(`/settings/connections/${conn.id}/edit`)
      },
      {
        key: 'delete',
        icon: IconDelete,
        label: m.storage_connections_delete(),
        class: 'text-error'
      }
    ];
  }

  const menuActions = $derived(menuConn ? actionsFor(menuConn) : []);

  function handleMenuAction(key: string, conn: ConnectionListItem | null) {
    if (key !== 'delete' || !conn) return;
    deleteTarget = conn;
    deleteConfirmOpen = true;
  }

  // Delete confirmation. Opening the modal closes the menu, so the target is kept separately.
  let deleteTarget: ConnectionListItem | null = $state(null);
  let deleteConfirmOpen = $state(false);
  let deleteFormEl = $state<HTMLFormElement | null>(null);

  const deleteConn = $derived.by<SavedConnection | null>(() => {
    if (!deleteTarget) return null;
    const ep = deleteTarget.endpoint ?? '';
    const colonIdx = ep.lastIndexOf(':');
    const host = colonIdx > 0 ? ep.slice(0, colonIdx) : ep;
    const port = colonIdx > 0 ? parseInt(ep.slice(colonIdx + 1), 10) || null : null;
    return {
      id: deleteTarget.id,
      name: deleteTarget.name,
      host,
      port,
      type: 's3',
      region: { name: '' }
    };
  });

  function confirmDelete() {
    deleteFormEl?.requestSubmit();
  }

  function cancelDelete() {
    deleteConfirmOpen = false;
    deleteTarget = null;
  }
</script>

<div class="mx-auto max-w-4xl p-6">
  <a href={resolve('/storage')} class="btn btn-ghost btn-sm mb-4 -ml-2">
    <IconArrowBack class="size-4" aria-hidden="true" />
    {m.storage_connections_back()}
  </a>

  <h2 class="mb-1 text-xl font-semibold">{m.storage_connections_title()}</h2>
  <p class="text-muted mb-6 text-sm">{m.storage_connections_subtitle()}</p>

  {#if deleteError}
    <div role="alert" class="alert alert-error mb-6 text-sm">{deleteError}</div>
  {/if}

  {#if connections.length === 0}
    <p class="text-muted text-sm">{m.storage_connections_empty()}</p>
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
              class="
                group hover:bg-base-300 has-[[aria-expanded=true]]:bg-base-200 cursor-default
                select-none
              "
              class:bg-base-200={menuConn?.id === conn.id}
              oncontextmenu={(e) => openContextMenu(e, conn)}
            >
              <td>
                <div class="flex items-center gap-2">
                  <IconStorage class="text-primary size-4 shrink-0" aria-hidden="true" />
                  <span class="font-medium">{connectionLabel(conn)}</span>
                </div>
              </td>
              <td class="text-muted font-mono text-xs">
                {conn.endpoint ?? '-'}
              </td>
              <td class="text-muted text-xs uppercase">s3</td>
              <td>
                <DropdownMenu
                  label={m.storage_connections_options({ label: connectionLabel(conn) })}
                  icon={IconMoreHoriz}
                  tooltip="left"
                  actions={actionsFor(conn)}
                  onaction={(key) => handleMenuAction(key, conn)}
                  triggerClass="
                    btn btn-ghost btn-xs btn-square opacity-0
                    group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100
                  "
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<ContextMenu
  x={menuPos.x}
  y={menuPos.y}
  open={menuConn !== null}
  onclose={closeContextMenu}
  onaction={(key) => handleMenuAction(key, menuConn)}
  actions={menuActions}
/>

{#if deleteTarget}
  <form method="POST" action="?/deleteConnection" bind:this={deleteFormEl} class="contents">
    <input type="hidden" name="connectionId" value={deleteTarget.id} />
  </form>
{/if}

<DeleteConnectionModal
  bind:open={deleteConfirmOpen}
  connection={deleteConn}
  onconfirm={confirmDelete}
  oncancel={cancelDelete}
/>
