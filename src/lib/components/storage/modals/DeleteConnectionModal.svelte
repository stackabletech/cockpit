<script lang="ts">
  import IconContentCopy from 'virtual:icons/material-symbols/content-copy';
  import IconCheck from 'virtual:icons/material-symbols/check';
  import Modal from '$lib/components/Modal.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import type { SavedConnection } from '$lib/storage/connection-storage.js';

  interface Props {
    open: boolean;
    connection: SavedConnection | null;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { open = $bindable(), connection, onconfirm, oncancel }: Props = $props();

  let copiedField: string | null = $state(null);

  function connectionLabel(conn: SavedConnection): string {
    return conn.name || conn.host || 'S3';
  }

  function copyField(value: string, field: string) {
    navigator.clipboard.writeText(value);
    copiedField = field;
    setTimeout(() => {
      copiedField = null;
    }, 1500);
  }

  function copyAll(conn: SavedConnection) {
    const host = conn.port ? `${conn.host}:${conn.port}` : conn.host;
    const lines = [
      `Host:        ${host}`,
      ...(conn.credentials?.accessKey ? [`Access key:  ${conn.credentials.accessKey}`] : []),
      `Region:      ${conn.region.name}`
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    copiedField = 'all';
    setTimeout(() => {
      copiedField = null;
    }, 1500);
  }
</script>

<Modal bind:open class="modal">
  <div class="modal-box max-w-lg">
    {#if connection}
      <p class="text-base-content mb-4 font-medium">
        {m.storage_connections_delete_confirm({ label: connectionLabel(connection) })}
      </p>
      <div class="rounded-box border-base-content/5 bg-base-100 overflow-x-auto border">
        <table class="table-sm table">
          <tbody>
            {#snippet copyBtn(value: string, field: string)}
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square"
                aria-label={copiedField === field
                  ? m.storage_connect_copied()
                  : m.storage_connect_copy()}
                onclick={() => copyField(value, field)}
              >
                {#if copiedField === field}
                  <IconCheck class="text-success h-4 w-4" />
                {:else}
                  <IconContentCopy class="h-4 w-4" />
                {/if}
              </button>
            {/snippet}
            <tr>
              <th>{m.storage_connect_host()}</th>
              <td class="border-base-content/10 border-l">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono">
                    {connection.port ? `${connection.host}:${connection.port}` : connection.host}
                  </span>
                  {@render copyBtn(
                    connection.port ? `${connection.host}:${connection.port}` : connection.host,
                    'host'
                  )}
                </div>
              </td>
            </tr>
            <tr>
              <th>{m.storage_connect_type()}</th>
              <td class="border-base-content/10 border-l">
                <div class="flex items-center justify-between gap-2">
                  <span>{m.storage_connect_type_s3()}</span>
                  {@render copyBtn(m.storage_connect_type_s3(), 'type')}
                </div>
              </td>
            </tr>
            {#if connection.credentials?.accessKey}
              <tr>
                <th>{m.storage_connect_access_key()}</th>
                <td class="border-base-content/10 border-l">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-mono">{connection.credentials.accessKey}</span>
                    {@render copyBtn(connection.credentials.accessKey, 'accessKey')}
                  </div>
                </td>
              </tr>
            {/if}
            {#if connection.region?.name}
              <tr>
                <th>{m.storage_connect_region()}</th>
                <td class="border-base-content/10 border-l">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-mono">{connection.region.name}</span>
                    {@render copyBtn(connection.region.name, 'region')}
                  </div>
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    {/if}
    <div class="modal-action">
      <button
        type="button"
        class="btn btn-ghost btn-sm mr-auto"
        onclick={() => connection && copyAll(connection)}
      >
        {#if copiedField === 'all'}
          <IconCheck class="text-success h-4 w-4" />
          {m.storage_connect_copied()}
        {:else}
          <IconContentCopy class="h-4 w-4" />
          {m.storage_connect_copy_all()}
        {/if}
      </button>
      <button type="button" class="btn btn-ghost btn-sm" onclick={oncancel}>
        {m.storage_connections_delete_cancel()}
      </button>
      <button type="button" class="btn btn-error btn-sm" onclick={onconfirm}>
        {m.storage_connections_delete_confirm_button()}
      </button>
    </div>
  </div>
</Modal>
