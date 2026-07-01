<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import { untrack } from 'svelte';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageConnectionSchema } from '$lib/storage/schemas.js';
  import {
    loadConnectionById,
    loadConnectionLocally,
    updateConnectionLocally,
    type SavedConnection
  } from '$lib/storage/connection-storage.js';

  let { data } = $props();

  const uid = $props.id();

  // Loaded client-side from localStorage
  let connection = $state<SavedConnection | null>(null);
  let loaded = $state(false);
  let isActiveConnection = $state(false);
  let saved = $state(false);

  // Extract the id from the URL via SvelteKit's page state
  const connectionId = page.params.id;

  const { form, errors, enhance, submitting, message } = superForm(
    untrack(() => data.editForm),
    {
      validators: zod(StorageConnectionSchema),
      onResult: ({ result }) => {
        if (result.type === 'success' && result.data?.form?.message === 'ok') {
          if (connection) {
            updateConnectionLocally(connection.id, { ...$form });
          }
          saved = true;
        }
      }
    }
  );

  onMount(() => {
    if (!connectionId) {
      goto('/storage/connections');
      return;
    }
    const found = loadConnectionById(connectionId);
    if (!found) {
      goto('/storage/connections');
      return;
    }
    connection = found;

    // Pre-fill form with current values
    $form.id = found.id;
    $form.name = found.name ?? '';
    $form.type = found.type;
    $form.endpoint = found.endpoint ?? '';
    $form.pathStyle = found.pathStyle ?? true;
    $form.region = found.region;
    $form.accessKeyId = found.accessKeyId ?? '';
    $form.secretAccessKey = found.secretAccessKey ?? '';

    // Check if this is the currently active connection
    const active = loadConnectionLocally();
    isActiveConnection = active?.id === found.id;

    loaded = true;
  });
</script>

<div class="mx-auto max-w-md p-6">
  <h1 class="mb-1 text-xl font-semibold">{m.storage_connection_edit_title()}</h1>

  {#if !loaded}
    <div class="flex items-center justify-center py-12">
      <span class="loading loading-spinner loading-md text-base-content/40"></span>
    </div>
  {:else}
    {#if isActiveConnection}
      <div role="note" class="alert mb-4 flex gap-2">
        <IconInfo class="size-5 shrink-0" aria-hidden="true" />
        <span class="text-sm">{m.storage_connection_edit_active_notice()}</span>
      </div>
    {/if}

    {#if saved}
      <div role="status" class="alert alert-success mb-4 flex gap-2">
        <IconCheckCircle class="size-5 shrink-0" aria-hidden="true" />
        <span class="text-sm">{m.storage_connection_edit_success()}</span>
      </div>
    {/if}

    <form method="POST" action="?/update" use:enhance class="flex flex-col gap-4">
      <input type="hidden" name="id" value={$form.id} />

      <!-- Connection name -->
      <div>
        <label for="{uid}-name" class="label mb-1 text-sm font-medium">
          {m.storage_connection_edit_name()}
        </label>
        <input
          id="{uid}-name"
          name="name"
          type="text"
          class="input-bordered input w-full"
          placeholder={m.storage_connection_edit_name_placeholder()}
          bind:value={$form.name}
        />
        <p class="text-base-content/50 mt-1 text-xs">{m.storage_connection_edit_name_hint()}</p>
      </div>

      <!-- Backend type (hidden — editing type not supported) -->
      <input type="hidden" name="type" value={$form.type} />

      <!-- Endpoint URL -->
      <div>
        <label for="{uid}-endpoint" class="label mb-1 text-sm font-medium">
          {m.storage_connect_endpoint()}
        </label>
        <input
          id="{uid}-endpoint"
          name="endpoint"
          type="url"
          class="input-bordered input w-full {$errors?.endpoint ? 'input-error' : ''}"
          placeholder={m.storage_connect_endpoint_placeholder()}
          bind:value={$form.endpoint}
        />
        <p class="text-base-content/50 mt-1 text-xs">{m.storage_connect_endpoint_hint()}</p>
        {#if $errors?.endpoint}
          <p class="text-error mt-1 text-xs">{$errors.endpoint}</p>
        {/if}
      </div>

      <!-- Path-style addressing -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <label for="{uid}-path-style" class="label text-sm font-medium">
            {m.storage_connect_path_style()}
          </label>
          <p class="text-base-content/50 mt-0.5 text-xs">{m.storage_connect_path_style_hint()}</p>
        </div>
        <input
          id="{uid}-path-style"
          name="pathStyle"
          type="checkbox"
          class="toggle toggle-primary mt-1 shrink-0"
          bind:checked={$form.pathStyle}
        />
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
          class="input-bordered input w-full {$errors?.region ? 'input-error' : ''}"
          bind:value={$form.region}
        />
        {#if $errors?.region}
          <p class="text-error mt-1 text-xs">{$errors.region}</p>
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
          class="input-bordered input w-full {$errors?.accessKeyId ? 'input-error' : ''}"
          autocomplete="username"
          bind:value={$form.accessKeyId}
        />
        {#if $errors?.accessKeyId}
          <p class="text-error mt-1 text-xs">{$errors.accessKeyId}</p>
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
          class="input-bordered input w-full {$errors?.secretAccessKey ? 'input-error' : ''}"
          autocomplete="current-password"
          bind:value={$form.secretAccessKey}
        />
        {#if $errors?.secretAccessKey}
          <p class="text-error mt-1 text-xs">{$errors.secretAccessKey}</p>
        {/if}
      </div>

      {#if $message && $message !== 'ok'}
        <p class="text-error text-sm">{$message}</p>
      {/if}

      <div class="flex items-center gap-3">
        <button type="submit" class="btn btn-primary" disabled={$submitting}>
          {#if $submitting}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {m.storage_connection_edit_save()}
        </button>
        <a href="/storage/connections" class="btn btn-ghost">
          ← {m.storage_connections_title()}
        </a>
      </div>
    </form>
  {/if}
</div>
