<script lang="ts">
  import { onMount } from 'svelte';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconClose from 'virtual:icons/material-symbols/close';
  import DeleteConnectionModal from '$lib/components/storage/DeleteConnectionModal.svelte';
  import { createResizablePanel } from './resizable-panel.svelte.js';
  import ResizeHandle from './ResizeHandle.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageRouteBase } from '$lib/storage/route-context.js';
  import {
    loadAllConnectionsLocally,
    removeConnectionLocally,
    type SavedConnection
  } from '$lib/storage/connection-storage.js';

  interface Props {
    /** ID of the connection currently being acted on (highlighted in the list). */
    activeId?: string;
    /** Called when the user clicks a connection row. */
    onselect: (conn: SavedConnection) => void;
  }

  let { activeId, onselect }: Props = $props();

  const routes = getStorageRouteBase();

  let allConnections: SavedConnection[] = $state([]);
  let connectionsLoaded = $state(false);
  let forgetCandidate: SavedConnection | null = $state(null);
  let forgetOpen = $state(false);

  const resize = createResizablePanel({
    storageKey: 'storage_connect_sidebar_width',
    defaultWidth: 224,
    minWidth: 140,
    maxWidth: 400
  });
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

  function connectionLabel(conn: SavedConnection): string {
    if (conn.name) return conn.name;
    return conn.port ? `${conn.host}:${conn.port}` : conn.host;
  }

  function openContextMenu(e: MouseEvent, conn: SavedConnection) {
    e.preventDefault();
    e.stopPropagation();
    const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menuRawPos = { left: btnRect.right, top: btnRect.bottom };
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

  function openForgetConfirm(conn: SavedConnection) {
    forgetCandidate = conn;
    forgetOpen = true;
  }

  function forgetConnection() {
    if (!forgetCandidate) return;
    removeConnectionLocally(forgetCandidate);
    allConnections = loadAllConnectionsLocally();
    forgetCandidate = null;
    forgetOpen = false;
  }

  onMount(() => {
    allConnections = loadAllConnectionsLocally();
    connectionsLoaded = true;
  });
</script>

<svelte:document onclick={handleOutsideClick} />
<svelte:window onkeydown={handleKeydown} />

<!-- Context menu (fixed, rendered outside the layout flow) -->
{#if menuConn}
  <ul
    bind:this={menuEl}
    class="
      menu menu-sm border-base-300 bg-base-100 fixed z-150 w-48 rounded-lg
      border p-1 shadow-lg
    "
    role="menu"
    tabindex="-1"
    style="left: {menuPos.left}px; top: {menuPos.top}px;"
  >
    <li role="none">
      <a
        href={`${routes.connectionsRoot}/${menuConn.id}/edit`}
        role="menuitem"
        onclick={closeContextMenu}
        class="justify-start"
      >
        <IconEdit class="size-4 shrink-0" aria-hidden="true" />
        {m.storage_connect_edit()}
      </a>
    </li>
    <li role="none">
      <button
        type="button"
        role="menuitem"
        class="text-error justify-start"
        onclick={() => {
          openForgetConfirm(menuConn!);
          closeContextMenu();
        }}
      >
        <IconClose class="size-4 shrink-0" aria-hidden="true" />
        {m.storage_connect_forget()}
      </button>
    </li>
  </ul>
{/if}

<!-- Mobile: horizontal scrollable connections row -->
<div class="md:hidden">
  {#if connectionsLoaded && allConnections.length > 0}
    <p class="text-base-content/50 mb-2 text-xs font-semibold tracking-wide uppercase">
      {m.storage_connect_saved()}
    </p>
    <div
      class="flex flex-nowrap gap-2 overflow-x-auto overflow-y-visible pb-1"
      role="list"
      aria-label={m.storage_connect_saved()}
    >
      {#each allConnections as conn (conn.id)}
        <div class="relative shrink-0" role="listitem">
          <button
            type="button"
            onclick={() => onselect(conn)}
            class="
              border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5 focus-visible:outline-primary
              flex flex-col items-center gap-1.5 rounded-xl
              border p-3 text-center transition-colors before:z-200
              {activeId === conn.id ? 'border-primary bg-primary/5' : ''}
            "
            title={connectionLabel(conn)}
            data-tip={connectionLabel(conn)}
          >
            <IconStorage class="text-primary size-8" aria-hidden="true" />
            <span class="w-20 truncate text-xs font-medium">{connectionLabel(conn)}</span>
          </button>
          <button
            type="button"
            aria-label={m.storage_connect_forget_label({ endpoint: connectionLabel(conn) })}
            onclick={(e) => {
              e.stopPropagation();
              openForgetConfirm(conn);
            }}
            class="
              border-base-300 bg-base-100 text-error hover:bg-error hover:text-error-content
              absolute -top-2 -right-2 flex size-5 items-center justify-center
              rounded-full border shadow-sm transition-colors
            "
          >
            <IconClose class="size-3" aria-hidden="true" />
          </button>
        </div>
      {/each}
    </div>
    <div class="mt-2 text-right">
      <a href={routes.connectionsRoot} class="link link-primary text-xs">
        {m.storage_connect_manage()}
      </a>
    </div>
  {/if}
</div>

<!-- Desktop: sidebar -->
<aside
  class="
    border-base-300 bg-base-100 sticky top-0
    hidden h-[calc(100dvh-7rem)] shrink-0 flex-col rounded-lg border md:flex
  "
  style="width: {resize.width}px"
  aria-label={m.storage_connect_saved()}
>
  <div class="border-base-300 border-b px-3 py-2">
    <span class="text-base-content/50 text-xs font-semibold tracking-wide uppercase">
      {m.storage_connect_saved()}
    </span>
  </div>

  <ul class="flex-1 overflow-y-auto py-1" role="list" aria-label={m.storage_connect_saved()}>
    {#if !connectionsLoaded}
      <li class="flex justify-center px-3 py-4">
        <span class="loading loading-spinner loading-sm text-base-content/40"></span>
      </li>
    {:else if allConnections.length === 0}
      <li class="text-base-content/40 px-3 py-4 text-center text-xs">
        {m.storage_connect_no_saved()}
      </li>
    {:else}
      {#each allConnections as conn (conn.id)}
        <li class="group relative">
          <div class="relative z-150 w-full">
            <button
              type="button"
              onclick={() => onselect(conn)}
              class="
              hover:bg-base-200 flex w-full min-w-0 items-center gap-2 px-3 py-1.5
                pr-7 text-sm
              {activeId === conn.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-base-content'}
            "
            >
              <IconStorage
                class="text-primary size-3.5 shrink-0 {activeId === conn.id ? '' : 'opacity-60'}"
                aria-hidden="true"
              />
              <span class="truncate">{connectionLabel(conn)}</span>
            </button>
          </div>

          <button
            type="button"
            onclick={(e) => openContextMenu(e, conn)}
            class="
              btn btn-ghost btn-xs absolute top-1/2 right-1 z-150 -translate-y-1/2
              p-0 opacity-0 transition-opacity
              group-hover:opacity-100 focus:opacity-100
            "
            aria-label={m.storage_more_options()}
            title={m.storage_more_options()}
          >
            <IconMoreHoriz class="size-3.5" aria-hidden="true" />
          </button>
        </li>
      {/each}
    {/if}
  </ul>

  <div class="border-base-300 border-t p-2">
    <a href={routes.connectionsRoot} class="btn btn-ghost btn-xs w-full justify-start text-xs">
      {m.storage_connect_manage()}
    </a>
  </div>

  <ResizeHandle panel={resize} />
</aside>

<!-- Delete confirmation modal -->
<DeleteConnectionModal
  bind:open={forgetOpen}
  connection={forgetCandidate}
  onconfirm={forgetConnection}
  oncancel={() => (forgetOpen = false)}
/>
