<script lang="ts">
  import type { SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import { onMount, tick, untrack } from 'svelte';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageConnectionSchema } from '$lib/storage/schemas.js';
  import {
    saveConnectionLocally,
    loadConnectionLocally,
    loadAllConnectionsLocally,
    removeConnectionLocally,
    type SavedConnection
  } from '$lib/storage/connection-storage.js';
  import { storageAutoConnectEnabled } from '$lib/client/feature-flags.js';
  import type { z } from 'zod';

  interface Props {
    connectionForm: SuperValidated<z.infer<typeof StorageConnectionSchema>, string>;
  }

  let { connectionForm }: Props = $props();

  const uid = $props.id();

  let formRef: HTMLFormElement | null = $state(null);
  let autoConnecting = $state(false);
  let allConnections: SavedConnection[] = $state([]);
  let connectionsLoaded = $state(false);

  /** Connection pending the "Forget" confirmation. */
  let forgetCandidate: SavedConnection | null = $state(null);

  const { form, errors, enhance, submitting, message } = superForm(
    untrack(() => connectionForm),
    {
      dataType: 'json',
      validators: zod(StorageConnectionSchema),
      onResult: ({ result }) => {
        if (result.type === 'redirect') {
          saveConnectionLocally({ ...$form, id: $form.id || crypto.randomUUID() });
        } else {
          autoConnecting = false;
        }
      }
    }
  );

  /** Display label for a saved connection: name, then host:port, then host. */
  function connectionLabel(conn: SavedConnection): string {
    if (conn.name) return conn.name;
    return conn.port ? `${conn.host}:${conn.port}` : conn.host;
  }

  /** Fill the form with a saved connection and immediately submit. */
  function selectConnection(conn: SavedConnection) {
    $form.id = conn.id;
    $form.name = conn.name ?? '';
    $form.type = conn.type;
    $form.host = conn.host;
    $form.port = conn.port;
    $form.tls = conn.tls;
    $form.accessStyle = conn.accessStyle;
    $form.region = conn.region;
    $form.credentials = conn.credentials;
    tick().then(() => formRef?.requestSubmit());
  }

  /** Forget a connection from local storage and refresh the list. */
  function forgetConnection(conn: SavedConnection) {
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
      $form.id = saved.id;
      $form.type = saved.type;
      $form.host = saved.host;
      $form.port = saved.port;
      $form.tls = saved.tls;
      $form.accessStyle = saved.accessStyle;
      $form.region = saved.region;
      $form.credentials = saved.credentials;
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
      class="mb-2 h-24 {connectionsLoaded && allConnections.length === 0
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
          {#each allConnections as conn (conn.id)}
            <div class="relative shrink-0" role="listitem">
              <button
                type="button"
                onclick={() => selectConnection(conn)}
                class="
                  border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5
                  focus-visible:outline-primary flex flex-col items-center gap-1.5 rounded-xl border
                  p-3 text-center transition-colors
                "
                title={connectionLabel(conn)}
              >
                <IconStorage class="text-primary size-8" aria-hidden="true" />
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
                <IconClose class="size-3" aria-hidden="true" />
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-base-content/50 text-sm">{m.storage_connect_no_saved()}</p>
      {/if}
    </div>
    {#if connectionsLoaded && allConnections.length > 0}
      <div class="mb-6 text-right">
        <a href="/storage/connections" class="link link-primary text-xs">
          {m.storage_connect_manage()}
        </a>
      </div>
    {/if}
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

    <!-- Host -->
    <div>
      <label for="{uid}-host" class="label mb-1 text-sm font-medium">
        {m.storage_connect_host()}
      </label>
      <input
        id="{uid}-host"
        name="host"
        type="text"
        class={['input-bordered input w-full', $errors?.host && 'input-error']}
        placeholder={m.storage_connect_host_placeholder()}
        bind:value={$form.host}
      />
      {#if $errors?.host}
        <p class="text-error mt-1 text-xs">{$errors.host}</p>
      {/if}
    </div>

    <!-- Port -->
    <div>
      <label for="{uid}-port" class="label mb-1 text-sm font-medium">
        {m.storage_connect_port()}
      </label>
      <input
        id="{uid}-port"
        name="port"
        type="number"
        min="1"
        max="65535"
        class={['input-bordered input w-full', $errors?.port && 'input-error']}
        placeholder={m.storage_connect_port_placeholder()}
        bind:value={$form.port}
      />
      <p class="text-base-content/50 mt-1 text-xs">{m.storage_connect_port_hint()}</p>
      {#if $errors?.port}
        <p class="text-error mt-1 text-xs">{$errors.port}</p>
      {/if}
    </div>

    <!-- TLS -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <label for="{uid}-tls" class="label text-sm font-medium">
          {m.storage_connect_tls()}
        </label>
        <p class="text-base-content/50 mt-0.5 text-xs">{m.storage_connect_tls_hint()}</p>
      </div>
      <input
        id="{uid}-tls"
        type="checkbox"
        class="toggle toggle-primary mt-1 shrink-0"
        checked={!!$form.tls}
        onchange={(e) => {
          $form.tls = e.currentTarget.checked ? { verification: 'Full' } : undefined;
        }}
      />
    </div>

    <!-- TLS verification (shown only when TLS is enabled) -->
    {#if $form.tls}
      <div class="flex items-start justify-between gap-4 pl-4">
        <div>
          <label for="{uid}-tls-verification" class="label text-sm font-medium">
            {m.storage_connect_tls_verification()}
          </label>
          <p class="text-base-content/50 mt-0.5 text-xs">
            {m.storage_connect_tls_verification_hint()}
          </p>
        </div>
        <input
          id="{uid}-tls-verification"
          type="checkbox"
          class="toggle toggle-primary mt-1 shrink-0"
          checked={$form.tls.verification === 'Full'}
          onchange={(e) => {
            $form.tls = { verification: e.currentTarget.checked ? 'Full' : 'None' };
          }}
        />
      </div>
    {/if}

    <!-- Access style -->
    <div>
      <label for="{uid}-access-style" class="label mb-1 text-sm font-medium">
        {m.storage_connect_access_style()}
      </label>
      <select
        id="{uid}-access-style"
        name="accessStyle"
        class="select-bordered select w-full"
        bind:value={$form.accessStyle}
      >
        <option value="Path">{m.storage_connect_access_style_path()}</option>
        <option value="VirtualHosted">{m.storage_connect_access_style_virtual_hosted()}</option>
      </select>
    </div>

    <!-- Region -->
    <div>
      <label for="{uid}-region" class="label mb-1 text-sm font-medium">
        {m.storage_connect_region()}
      </label>
      <input
        id="{uid}-region"
        name="region.name"
        type="text"
        class={['input-bordered input w-full', $errors?.region?.name && 'input-error']}
        bind:value={$form.region.name}
      />
      {#if $errors?.region?.name}
        <p class="text-error mt-1 text-xs">{$errors.region.name}</p>
      {/if}
    </div>

    <!-- Access key -->
    <div>
      <label for="{uid}-access-key" class="label mb-1 text-sm font-medium">
        {m.storage_connect_access_key()}
      </label>
      <input
        id="{uid}-access-key"
        name="credentials.accessKey"
        type="text"
        class={['input-bordered input w-full', $errors?.credentials?.accessKey && 'input-error']}
        autocomplete="username"
        bind:value={$form.credentials.accessKey}
      />
      {#if $errors?.credentials?.accessKey}
        <p class="text-error mt-1 text-xs">{$errors.credentials.accessKey}</p>
      {/if}
    </div>

    <!-- Secret key -->
    <div>
      <label for="{uid}-secret-key" class="label mb-1 text-sm font-medium">
        {m.storage_connect_secret_key()}
      </label>
      <input
        id="{uid}-secret-key"
        name="credentials.secretKey"
        type="password"
        class={['input-bordered input w-full', $errors?.credentials?.secretKey && 'input-error']}
        autocomplete="current-password"
        bind:value={$form.credentials.secretKey}
      />
      {#if $errors?.credentials?.secretKey}
        <p class="text-error mt-1 text-xs">{$errors.credentials.secretKey}</p>
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
