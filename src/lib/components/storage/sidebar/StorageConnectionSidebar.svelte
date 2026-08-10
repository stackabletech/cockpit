<script lang="ts">
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconEdit from 'virtual:icons/material-symbols/edit';
  import IconClose from 'virtual:icons/material-symbols/close';
  import TooltipTrigger from '$lib/components/TooltipTrigger.svelte';
  import { createResizablePanel } from './resizable-panel.svelte.js';
  import ResizeHandle from './ResizeHandle.svelte';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages.js';
  import type { ConnectionMetadata } from '$lib/server/storage/types.js';
  import DeleteConnectionModal from '$lib/components/storage/modals/DeleteConnectionModal.svelte';
  import type { SavedConnection } from '$lib/storage/connection-id-header.js';

  interface Props {
    /** List of saved connections from the server. */
    connections: ConnectionMetadata[];
    /** ID of the connection currently being acted on (highlighted in the list). */
    activeId?: string;
    /**
     * Callback when a connection is selected. When provided, clicking a connection
     * calls this callback instead of submitting the `?/use` form (which activates
     * the connection server-side). Use this on edit pages to navigate between
     * connection edits rather than activating them.
     */
    onselect?: (conn: ConnectionMetadata) => void;
  }

  let { connections, activeId, onselect }: Props = $props();

  const resize = createResizablePanel({
    storageKey: 'storage_connect_sidebar_width',
    defaultWidth: 224,
    minWidth: 140,
    maxWidth: 400
  });
  let menuConn: ConnectionMetadata | null = $state(null);
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

  // ── Tooltip ──────────────────────────────────────────────────────────────
  function connectionLabel(conn: ConnectionMetadata): string {
    return conn.name || conn.endpoint || 'S3';
  }

  function openContextMenu(e: MouseEvent, conn: ConnectionMetadata) {
    e.preventDefault();
    e.stopPropagation();
    menuRawPos = { left: e.clientX, top: e.clientY };
    menuConn = conn;
  }

  function handleConnectionKeydown(e: KeyboardEvent, conn: ConnectionMetadata) {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    e.preventDefault();
    menuRawPos = { left: rect.left, top: rect.bottom };
    menuConn = conn;
  }

  function closeContextMenu() {
    menuConn = null;
  }

  function handleOutsideClick(e: MouseEvent) {
    if (deleteConfirmOpen) return;
    if (menuConn && menuEl && !menuEl.contains(e.target as Node)) closeContextMenu();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (menuConn && e.key === 'Escape') closeContextMenu();
  }

  // Delete confirmation
  let deleteConfirmOpen = $state(false);
  let deleteFormEl = $state<HTMLFormElement | null>(null);

  function confirmDelete() {
    deleteFormEl?.requestSubmit();
  }

  function cancelDelete() {
    deleteConfirmOpen = false;
    closeContextMenu();
  }

  const deleteConn = $derived.by<SavedConnection | null>(() => {
    if (!menuConn) return null;
    const ep = menuConn.endpoint ?? '';
    const colonIdx = ep.lastIndexOf(':');
    const host = colonIdx > 0 ? ep.slice(0, colonIdx) : ep;
    const port = colonIdx > 0 ? parseInt(ep.slice(colonIdx + 1), 10) || null : null;
    return { id: menuConn.id, name: menuConn.name, host, port, type: 's3', region: { name: '' } };
  });
</script>

<svelte:document onclick={handleOutsideClick} />
<svelte:window onkeydown={handleKeydown} />

<!-- Context menu (fixed, rendered outside the layout flow) -->
{#if menuConn}
  <form method="POST" action="?/deleteConnection" bind:this={deleteFormEl} class="contents">
    <input type="hidden" name="connectionId" value={menuConn.id} />
  </form>
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
        href={resolve(`/storage/connections/${menuConn.id}/edit`)}
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
        class="text-error w-full justify-start"
        onclick={() => (deleteConfirmOpen = true)}
      >
        <IconClose class="size-4 shrink-0" aria-hidden="true" />
        {m.storage_connect_forget()}
      </button>
    </li>
  </ul>

  <DeleteConnectionModal
    open={deleteConfirmOpen}
    connection={deleteConn}
    onconfirm={confirmDelete}
    oncancel={cancelDelete}
  />
{/if}

<!-- Mobile: horizontal scrollable connections row -->
<div class="md:hidden">
  {#if connections.length > 0}
    <p class="text-base-content/50 mb-2 text-xs font-semibold tracking-wide uppercase">
      {m.storage_connect_saved()}
    </p>
    <div
      class="flex flex-nowrap gap-2 overflow-x-auto overflow-y-visible pb-1"
      role="list"
      aria-label={m.storage_connect_saved()}
    >
      {#each connections as conn (conn.id)}
        <div class="relative shrink-0" role="listitem">
          {#if onselect}
            <button
              type="button"
              onclick={() => onselect(conn)}
              class="
                border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5 focus-visible:outline-primary
                flex flex-col items-center gap-1.5 rounded-xl
                border p-3 text-center transition-colors
                {activeId === conn.id ? 'border-primary bg-primary/5' : ''}
              "
              title={connectionLabel(conn)}
              data-tip={connectionLabel(conn)}
            >
              <IconStorage class="text-primary size-8" aria-hidden="true" />
              <span class="w-20 truncate text-xs font-medium">{connectionLabel(conn)}</span>
            </button>
          {:else}
            <form method="POST" action="?/use">
              <input type="hidden" name="connectionId" value={conn.id} />
              <button
                type="submit"
                class="
                  border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5 focus-visible:outline-primary
                  flex flex-col items-center gap-1.5 rounded-xl
                  border p-3 text-center transition-colors
                  {activeId === conn.id ? 'border-primary bg-primary/5' : ''}
                "
                title={connectionLabel(conn)}
                data-tip={connectionLabel(conn)}
              >
                <IconStorage class="text-primary size-8" aria-hidden="true" />
                <span class="w-20 truncate text-xs font-medium">{connectionLabel(conn)}</span>
              </button>
            </form>
          {/if}
          <form
            method="POST"
            action="?/deleteConnection"
            onsubmit={() => {
              // Redirect handles the page update
            }}
            class="absolute -top-2 -right-2"
          >
            <input type="hidden" name="connectionId" value={conn.id} />
            <button
              type="submit"
              aria-label={m.storage_connect_forget_label({ endpoint: connectionLabel(conn) })}
              class="
                border-base-300 bg-base-100 text-error hover:bg-error hover:text-error-content
                flex size-5 items-center justify-center
                rounded-full border shadow-sm transition-colors
              "
            >
              <IconClose class="size-3" aria-hidden="true" />
            </button>
          </form>
        </div>
      {/each}
    </div>
    <div class="mt-2 text-right">
      <a href={resolve('/storage/connections')} class="link link-primary text-xs">
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
  style="width: {resize.width}px; min-width: {resize.minWidth}px"
  aria-label={m.storage_connect_saved()}
>
  <div class="border-base-300 border-b px-3 py-2">
    <span class="text-base-content/50 text-xs font-semibold tracking-wide uppercase">
      {m.storage_connect_saved()}
    </span>
  </div>

  <ul class="flex-1 overflow-y-auto py-1" role="list" aria-label={m.storage_connect_saved()}>
    {#if connections.length === 0}
      <li class="text-base-content/40 px-3 py-4 text-center text-xs">
        {m.storage_connect_no_saved()}
      </li>
    {:else}
      {#each connections as conn (conn.id)}
        <li class="group relative">
          <div class="relative z-150 w-full">
            {#if onselect}
              <TooltipTrigger text={connectionLabel(conn)} orientation="right">
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
                    class="text-primary size-3.5 shrink-0 {activeId === conn.id
                      ? ''
                      : 'opacity-60'}"
                    aria-hidden="true"
                  />
                  <span class="truncate">{connectionLabel(conn)}</span>
                </button>
              </TooltipTrigger>
            {:else}
              <form method="POST" action="?/use">
                <input type="hidden" name="connectionId" value={conn.id} />
                <TooltipTrigger text={connectionLabel(conn)} orientation="right">
                  <button
                    type="submit"
                    class="
                      hover:bg-base-200 flex w-full min-w-0 items-center gap-2 px-3 py-1.5
                      pr-7 text-sm
                      {activeId === conn.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-base-content'}
                    "
                  >
                    <IconStorage
                      class="text-primary size-3.5 shrink-0 {activeId === conn.id
                        ? ''
                        : 'opacity-60'}"
                      aria-hidden="true"
                    />
                    <span class="truncate">{connectionLabel(conn)}</span>
                  </button>
                </TooltipTrigger>
              </form>
            {/if}
          </div>

          <TooltipTrigger text={m.storage_more_options()} orientation="right">
            <button
              type="button"
              onclick={(e) => openContextMenu(e, conn)}
              class="
                btn btn-ghost btn-xs absolute top-1/2 right-1 z-150 -translate-y-1/2
                p-0 opacity-0 transition-opacity
                group-hover:opacity-100 focus:opacity-100
              "
              aria-label={m.storage_more_options()}
            >
              <IconMoreHoriz class="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
        </li>
      {/each}
    {/if}
  </ul>

  <div class="border-base-300 border-t p-2">
    <a
      href={resolve('/storage/connections')}
      class="btn btn-ghost btn-xs w-full justify-start text-xs"
    >
      {m.storage_connect_manage()}
    </a>
  </div>

  <ResizeHandle panel={resize} />
</aside>
