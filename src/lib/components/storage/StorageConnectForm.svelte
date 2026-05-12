<script lang="ts">
  import type { SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import { onMount, tick } from 'svelte';
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageConnectionSchema } from '$lib/storage/schemas.js';
  import {
    saveConnectionLocally,
    loadConnectionLocally,
    loadAllConnectionsLocally,
    removeConnectionLocally
  } from '$lib/storage/connection-storage.js';
  import { storageAutoConnectEnabled } from '$lib/client/feature-flags.js';
  import type { z } from 'zod';

  type StoredConnection = z.infer<typeof StorageConnectionSchema>;

  interface Props {
    connectionForm: SuperValidated<z.infer<typeof StorageConnectionSchema>, string>;
  }

  let { connectionForm }: Props = $props();

  const uid = $props.id();

  let formRef: HTMLFormElement | null = $state(null);
  let autoConnecting = $state(false);
  let allConnections: StoredConnection[] = $state([]);
  let connectionsLoaded = $state(false);

  /** Connection pending the "Forget" confirmation. */
  let forgetCandidate: StoredConnection | null = $state(null);

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
    forgetCandidate = conn;
  }

  /** Forget a connection from local storage and refresh the list. */
  function forgetConnection(conn: StoredConnection) {
    removeConnectionLocally(conn);
    allConnections = loadAllConnectionsLocally();
    forgetCandidate = null;
  }

  onMount(() => {
    allConnections = loadAllConnectionsLocally();
    connectionsLoaded = true;
    const params = new URLSearchParams(window.location.search);
    if (!storageAutoConnectEnabled || params.has('disconnected')) return;
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
      class="mb-6 h-24 {connectionsLoaded && allConnections.length === 0
        ? 'bg-base-200 flex items-center justify-center rounded-xl'
        : ''}"
    >
      {#if !connectionsLoaded}
        <div class="flex h-full items-center justify-center">
          <span class="loading loading-spinner loading-sm text-base-content/40"></span>
        </div>
      {:else if allConnections.length > 0}
        <p class="text-base-content/50 mb-2 text-xs font-semibold tracking-wide uppercase">
          {m.storage_connect_saved()}
        </p>
        <div
          class="flex flex-nowrap gap-2 overflow-x-auto overflow-y-visible pt-2 pb-1"
          role="list"
          aria-label={m.storage_connect_saved()}
        >
          {#each allConnections as conn (conn.type + '|' + (conn.endpoint ?? '') + '|' + (conn.accessKeyId ?? ''))}
            <div class="relative shrink-0" role="listitem">
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
              <button
                type="button"
                aria-label={m.storage_connect_forget_label({ endpoint: connectionLabel(conn) })}
                onclick={(e) => {
                  e.stopPropagation();
                  forgetCandidate = conn;
                }}
                class="
                  border-base-300 bg-base-100 text-error hover:bg-error hover:text-error-content
                  absolute -top-2 -right-2 flex size-5 items-center justify-center
                  rounded-full border shadow-sm transition-colors
                "
              >
                <Icon icon="material-symbols:close" class="size-3" aria-hidden="true" />
              </button>
            </div>
          {/each}
        </div>
      {:else}
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

{#if forgetCandidate}
  <dialog open class="modal modal-open">
    <div class="modal-box">
      <p class="text-base-content font-medium">
        {m.storage_connect_forget_confirm({ endpoint: connectionLabel(forgetCandidate) })}
      </p>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (forgetCandidate = null)}>
          {m.storage_connect_forget_cancel()}
        </button>
        <button
          type="button"
          class="btn btn-error btn-sm"
          onclick={() => forgetConnection(forgetCandidate!)}
        >
          {m.storage_connect_forget()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => (forgetCandidate = null)}>close</button>
    </form>
  </dialog>
{/if}
