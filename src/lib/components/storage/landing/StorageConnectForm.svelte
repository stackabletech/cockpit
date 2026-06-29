<script lang="ts">
  import type { SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import { untrack } from 'svelte';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import Modal from '$lib/components/Modal.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageConnectionSchema } from '$lib/storage/schemas.js';
  import type { ConnectionMetadata } from '$lib/server/storage/types.js';
  import type { z } from 'zod';

  interface Props {
    connectionForm: SuperValidated<z.infer<typeof StorageConnectionSchema>, string>;
    connections: ConnectionMetadata[];
    connectError: string | null;
  }

  let { connectionForm, connections, connectError }: Props = $props();

  const uid = $props.id();

  /** Connection pending the "Forget" confirmation. */
  let forgetCandidate: ConnectionMetadata | null = $state(null);
  let forgetModalOpen = $state(false);
  let forgetForm = $state<HTMLFormElement | null>(null);

  function confirmForget() {
    forgetModalOpen = false;
    forgetForm?.requestSubmit();
  }

  const { form, errors, enhance, submitting, message } = superForm(
    untrack(() => connectionForm),
    { validators: zod(StorageConnectionSchema) }
  );

  /** Display label for a saved connection. */
  function connectionLabel(conn: ConnectionMetadata): string {
    return conn.name;
  }
</script>

<div class="mx-auto max-w-md p-6">
  <div>
    <h1 class="mb-1 text-xl font-semibold">{m.storage_connect_title()}</h1>
    <p class="text-base-content/60 mb-6 text-sm">{m.storage_connect_subtitle()}</p>

    {#if connectError}
      <div role="alert" class="alert alert-error mb-6 text-sm">
        {m.storage_connect_error_unreachable()}
      </div>
    {/if}

    <div
      class="mb-6 h-24 {connections.length === 0
        ? 'bg-base-200 flex items-center justify-center rounded-xl'
        : ''}"
    >
      {#if connections.length > 0}
        <p class="text-base-content/50 mb-2 text-xs font-semibold tracking-wide uppercase">
          {m.storage_connect_saved()}
        </p>
        <div
          class="flex flex-nowrap gap-2 overflow-x-auto overflow-y-visible pt-2 pb-1"
          role="list"
          aria-label={m.storage_connect_saved()}
        >
          {#each connections as conn (conn.id)}
            <div class="relative shrink-0" role="listitem">
              <form method="POST" action="?/use">
                <input type="hidden" name="connectionId" value={conn.id} />
                <button
                  type="submit"
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
              </form>
              <button
                type="button"
                aria-label={m.storage_connect_forget_label({ endpoint: connectionLabel(conn) })}
                onclick={(e) => {
                  e.stopPropagation();
                  forgetCandidate = conn;
                  forgetModalOpen = true;
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
  </div>

  <form method="POST" action="?/connect" use:enhance class="flex flex-col gap-4">
    <!-- Backend type -->
    <div>
      <label for="{uid}-type" class="label mb-1 text-sm font-medium">
        {m.storage_connect_type()}
      </label>
      <select id="{uid}-type" name="type" class="select w-full" bind:value={$form.type}>
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
        class="input w-full {$errors?.endpoint ? 'input-error' : ''}"
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
        class="input w-full {$errors?.region ? 'input-error' : ''}"
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
        class="input w-full {$errors?.accessKeyId ? 'input-error' : ''}"
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
        class="input w-full {$errors?.secretAccessKey ? 'input-error' : ''}"
        autocomplete="current-password"
        bind:value={$form.secretAccessKey}
      />
      {#if $errors?.secretAccessKey}
        <p class="text-error mt-1 text-xs">{$errors.secretAccessKey}</p>
      {/if}
    </div>

    {#if $message}
      <p class="text-error text-sm">{$message}</p>
    {/if}

    <button type="submit" class="btn btn-primary" disabled={$submitting}>
      {#if $submitting}
        <span class="loading loading-sm loading-spinner" aria-hidden="true"></span>
      {/if}
      {m.storage_connect_submit()}
    </button>
  </form>
</div>

<!-- Form for the forget server action. Lives outside the <dialog> so the
     submit button can be a plain type="button" with onclick — matching the
     pattern used by the Disconnect modal and avoiding Playwright stability
     issues caused by the native dialog backdrop. -->
<form
  bind:this={forgetForm}
  method="POST"
  action="?/deleteConnection"
  onsubmit={() => {
    forgetCandidate = null;
  }}
  style="display: none"
>
  <input type="hidden" name="connectionId" value={forgetCandidate?.id ?? ''} />
</form>

<!-- Forget confirmation modal -->
<Modal bind:open={forgetModalOpen} class="modal">
  <div class="modal-box">
    <p class="text-base-content font-medium">
      {m.storage_connect_forget_confirm({ endpoint: forgetCandidate?.name ?? '' })}
    </p>
    <div class="modal-action">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={() => {
          forgetModalOpen = false;
          forgetCandidate = null;
        }}
      >
        {m.storage_connect_forget_cancel()}
      </button>
      <button type="button" class="btn btn-error btn-sm" onclick={confirmForget}>
        {m.storage_connect_forget()}
      </button>
    </div>
  </div>
</Modal>
