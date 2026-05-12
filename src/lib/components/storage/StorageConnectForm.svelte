<script lang="ts">
  import type { SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import { onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageConnectionSchema } from '$lib/storage/schemas.js';
  import {
    saveConnectionLocally,
    loadConnectionLocally,
    loadAllConnectionsLocally,
    removeConnectionLocally
  } from '$lib/storage/connection-storage.js';
  import type { z } from 'zod';

  type StoredConnection = z.infer<typeof StorageConnectionSchema>;

  interface Props {
    connectionForm: SuperValidated<z.infer<typeof StorageConnectionSchema>, string>;
  }

  let { connectionForm }: Props = $props();

  const uid = $props.id();

  let formRef: HTMLFormElement | null = $state(null);
  let autoConnecting = $state(false);
  let allConnections: StoredConnection[] = $state(browser ? loadAllConnectionsLocally() : []);

  /** Context-menu state: position and which connection was right-clicked. */
  let contextMenu: { x: number; y: number; conn: StoredConnection } | null = $state(null);

  const { form, errors, enhance, submitting, message } = superForm(connectionForm, {
    validators: zod(StorageConnectionSchema),
    onResult: ({ result }) => {
      if (result.type === 'redirect') {
        saveConnectionLocally($form);
      } else {
        autoConnecting = false;
      }
    }
  });

  /** Display label for a saved connection (hostname or "AWS S3"). */
  function connectionLabel(conn: StoredConnection): string {
    if (conn.endpoint) {
      try {
        return new URL(conn.endpoint).hostname;
      } catch {
        return conn.endpoint;
      }
    }
    return 'AWS S3';
  }

  /** Fill the form with a saved connection and immediately submit. */
  function selectConnection(conn: StoredConnection) {
    $form.type = conn.type;
    $form.endpoint = conn.endpoint ?? '';
    $form.region = conn.region;
    $form.accessKeyId = conn.accessKeyId ?? '';
    $form.secretAccessKey = conn.secretAccessKey ?? '';
    tick().then(() => formRef?.requestSubmit());
  }

  /** Open the right-click context menu for a connection. */
  function openContextMenu(event: MouseEvent, conn: StoredConnection) {
    event.preventDefault();
    contextMenu = { x: event.clientX, y: event.clientY, conn };
  }

  /** Forget a connection from local storage and refresh the list. */
  function forgetConnection(conn: StoredConnection) {
    removeConnectionLocally(conn);
    allConnections = loadAllConnectionsLocally();
    contextMenu = null;
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('disconnected')) return;
    const saved = loadConnectionLocally();
    if (saved) {
      autoConnecting = true;
      $form.type = saved.type;
      $form.endpoint = saved.endpoint ?? '';
      $form.region = saved.region;
      $form.accessKeyId = saved.accessKeyId ?? '';
      $form.secretAccessKey = saved.secretAccessKey ?? '';
      tick().then(() => formRef?.requestSubmit());
    }
  });
</script>

<svelte:window onclick={() => (contextMenu = null)} />

<div class="mx-auto max-w-md p-6">
  {#if autoConnecting}
    <div class="flex flex-col items-center gap-3 py-8">
      <span class="loading loading-spinner loading-md"></span>
      <p class="text-base-content/60 text-sm">{m.storage_connect_reconnecting()}</p>
    </div>
  {/if}

  <div class:hidden={autoConnecting}>
    <h1 class="mb-1 text-xl font-semibold">{m.storage_connect_title()}</h1>
    <p class="text-base-content/60 mb-6 text-sm">{m.storage_connect_subtitle()}</p>

    <div
      class="mb-6 h-24 {browser && allConnections.length === 0
        ? 'bg-base-100 flex items-center justify-center rounded-xl'
        : ''}"
    >
      {#if browser && allConnections.length > 0}
        <p class="text-base-content/50 mb-2 text-xs font-semibold tracking-wide uppercase">
          {m.storage_connect_saved()}
        </p>
        <div
          class="flex flex-nowrap gap-2 overflow-x-auto pb-1"
          role="list"
          aria-label={m.storage_connect_saved()}
        >
          {#each allConnections as conn (conn.type + '|' + (conn.endpoint ?? '') + '|' + (conn.accessKeyId ?? ''))}
            <div class="shrink-0" role="listitem">
              <button
                type="button"
                onclick={() => selectConnection(conn)}
                oncontextmenu={(e) => openContextMenu(e, conn)}
                class="
                  border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5
                  focus-visible:outline-primary flex flex-col items-center gap-1.5 rounded-xl border
                  p-3 text-center transition-colors
                "
                title={connectionLabel(conn)}
              >
                <Icon
                  icon="material-symbols:storage"
                  class="text-primary size-8"
                  aria-hidden="true"
                />
                <span class="w-20 truncate text-xs font-medium">{connectionLabel(conn)}</span>
              </button>
            </div>
          {/each}
        </div>
      {:else if browser}
        <p class="text-base-content/50 text-sm">{m.storage_connect_no_saved()}</p>
      {/if}
    </div>
  </div>

  <form
    bind:this={formRef}
    method="POST"
    action="?/connect"
    use:enhance
    class:hidden={autoConnecting}
    class="
    flex flex-col gap-4
  "
  >
    <!-- Backend type -->
    <div>
      <label for="{uid}-type" class="label mb-1 text-sm font-medium">
        {m.storage_connect_type()}
      </label>
      <select
        id="{uid}-type"
        name="type"
        class="select-bordered select w-full"
        bind:value={$form.type}
      >
        <option value="s3">{m.storage_connect_type_s3()}</option>
        <option value="hdfs" disabled>{m.storage_connect_type_hdfs()}</option>
      </select>
    </div>

    <!-- Endpoint URL -->
    <div>
      <label for="{uid}-endpoint" class="label mb-1 text-sm font-medium">
        {m.storage_connect_endpoint()}
      </label>
      <input
        id="{uid}-endpoint"
        name="endpoint"
        type="url"
        class="
          input-bordered input w-full
          {$errors?.endpoint ? 'input-error' : ''}"
        placeholder={m.storage_connect_endpoint_placeholder()}
        bind:value={$form.endpoint}
      />
      <p class="text-base-content/50 mt-1 text-xs">{m.storage_connect_endpoint_hint()}</p>
      {#if $errors?.endpoint}
        <p class="text-error mt-1 text-xs">{$errors?.endpoint}</p>
      {/if}
    </div>

    <!-- Region -->
    <div>
      <label for="{uid}-region" class="label mb-1 text-sm font-medium">
        {m.storage_connect_region()}
      </label>
      <input
        id="{uid}-region"
        name="region"
        type="text"
        class="
          input-bordered input w-full
          {$errors?.region ? 'input-error' : ''}"
        bind:value={$form.region}
      />
      {#if $errors?.region}
        <p class="text-error mt-1 text-xs">{$errors?.region}</p>
      {/if}
    </div>

    <!-- Access key ID -->
    <div>
      <label for="{uid}-access-key" class="label mb-1 text-sm font-medium">
        {m.storage_connect_access_key()}
      </label>
      <input
        id="{uid}-access-key"
        name="accessKeyId"
        type="text"
        class="
          input-bordered input w-full
          {$errors?.accessKeyId ? 'input-error' : ''}"
        autocomplete="username"
        bind:value={$form.accessKeyId}
      />
      {#if $errors?.accessKeyId}
        <p class="text-error mt-1 text-xs">{$errors?.accessKeyId}</p>
      {/if}
    </div>

    <!-- Secret access key -->
    <div>
      <label for="{uid}-secret-key" class="label mb-1 text-sm font-medium">
        {m.storage_connect_secret_key()}
      </label>
      <input
        id="{uid}-secret-key"
        name="secretAccessKey"
        type="password"
        class="
          input-bordered input w-full
          {$errors?.secretAccessKey ? `input-error` : ''}"
        autocomplete="current-password"
        bind:value={$form.secretAccessKey}
      />
      {#if $errors?.secretAccessKey}
        <p class="text-error mt-1 text-xs">{$errors?.secretAccessKey}</p>
      {/if}
    </div>

    {#if $message}
      <p class="text-error text-sm">{$message}</p>
    {/if}

    <button type="submit" class="btn btn-primary" disabled={$submitting}>
      {#if $submitting}
        <span class="loading loading-sm loading-spinner"></span>
      {/if}
      {m.storage_connect_submit()}
    </button>
  </form>
</div>

{#if contextMenu}
  <ul
    role="menu"
    style="position: fixed; left: {contextMenu.x}px; top: {contextMenu.y}px; z-index: 50;"
    class="menu bg-base-100 border-base-300 rounded-box w-40 border p-1 shadow-lg"
    onclick={(e) => e.stopPropagation()}
  >
    <li role="none">
      <button
        role="menuitem"
        class="text-error"
        onclick={() => forgetConnection(contextMenu!.conn)}
      >
        <Icon icon="material-symbols:delete-outline" class="size-4" aria-hidden="true" />
        {m.storage_connect_forget()}
      </button>
    </li>
  </ul>
{/if}
