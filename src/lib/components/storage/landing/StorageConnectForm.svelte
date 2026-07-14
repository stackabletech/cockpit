<script lang="ts">
  import { untrack } from 'svelte';
  import type { SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageConnectionSchema } from '$lib/storage/schemas.js';
  import type { ConnectionMetadata } from '$lib/server/storage/types.js';
  import StorageConnectionSidebar from '$lib/components/storage/sidebar/StorageConnectionSidebar.svelte';
  import type { z } from 'zod';

  interface Props {
    connectionForm: SuperValidated<z.infer<typeof StorageConnectionSchema>, string>;
    connections: ConnectionMetadata[];
    connectError: string | null;
  }

  let { connectionForm, connections, connectError }: Props = $props();

  const uid = $props.id();

  const { form, errors, enhance, submitting, message } = superForm(
    untrack(() => connectionForm),
    {
      dataType: 'json',
      validators: zod(StorageConnectionSchema),
      onResult: ({ result }) => {
        if (result.type === 'redirect') {
          // Server saved the connection; the redirect to /storage triggers
          // the layout load to auto-connect via activeStorageConnectionId.
        }
      }
    }
  );

  function parseHostInput() {
    const v = $form.host?.trim();
    if (!v?.includes('://')) return;
    try {
      const url = new URL(v);
      $form.host = url.hostname;
      if (url.port) $form.port = Number(url.port);
      $form.tls = url.protocol === 'https:' ? { verification: 'Full' } : undefined;
    } catch {
      // Not a parseable URL — leave unchanged
    }
  }
</script>

<div class="flex flex-col gap-4 md:flex-row md:items-start">
  <StorageConnectionSidebar {connections} />

  <div class="min-w-0 flex-1">
    <h1 class="mb-1 text-xl font-semibold">{m.storage_connect_title()}</h1>
    <p class="text-base-content/60 mb-6 text-sm">{m.storage_connect_subtitle()}</p>

    {#if connectError}
      <div role="alert" class="alert alert-error mb-6 text-sm">
        {m.storage_connect_error_unreachable()}
      </div>
    {/if}

    <form method="POST" action="?/connect" use:enhance class="flex flex-col gap-4">
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

      <div>
        <label for="{uid}-host" class="label mb-1 text-sm font-medium"
          >{m.storage_connect_host()}</label
        >
        <input
          id="{uid}-host"
          name="host"
          type="text"
          class={['input-bordered input w-full', $errors?.host && 'input-error']}
          placeholder={m.storage_connect_host_placeholder()}
          bind:value={$form.host}
          onblur={parseHostInput}
        />
        {#if $errors?.host}
          <p class="text-error mt-1 text-xs">{$errors.host}</p>
        {/if}
      </div>

      <div>
        <label for="{uid}-port" class="label mb-1 text-sm font-medium"
          >{m.storage_connect_port()}</label
        >
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

      <div class="flex items-start justify-between gap-4">
        <div>
          <label for="{uid}-tls" class="label text-sm font-medium">{m.storage_connect_tls()}</label>
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

      <div>
        <label for="{uid}-region" class="label mb-1 text-sm font-medium"
          >{m.storage_connect_region()}</label
        >
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

      <div>
        <label for="{uid}-access-key" class="label mb-1 text-sm font-medium"
          >{m.storage_connect_access_key()}</label
        >
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

      <div>
        <label for="{uid}-secret-key" class="label mb-1 text-sm font-medium"
          >{m.storage_connect_secret_key()}</label
        >
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
</div>
