<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, beforeNavigate } from '$app/navigation';
  import { resolve, resolveRoute } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import { untrack } from 'svelte';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { EditStorageConnectionSchema } from '$lib/storage/schemas.js';
  import { connectionStore } from '$lib/storage/connection-store.svelte.js';

  let { data } = $props();

  const uid = $props.id();

  let loaded = $state(false);
  let isActiveConnection = $derived(connectionStore.activeConnectionId === data.connectionId);

  // Unsaved-changes guard
  let initialSnapshot = $state.raw('');
  let confirmLeaveOpen = $state(false);
  let pendingNavigation = $state<string | null>(null);
  let bypassDirtyCheck = false;

  const { form, errors, enhance, submitting, message } = superForm(
    untrack(() => data.editForm),
    {
      dataType: 'json',
      validators: zod(EditStorageConnectionSchema),
      onResult: ({ result, cancel }) => {
        if (result.type === 'success' && result.data?.form?.message === 'ok') {
          cancel();
          bypassDirtyCheck = true;
          goto(resolve('/settings/connections'));
        }
      }
    }
  );

  function isFormDirty(): boolean {
    return loaded && !!initialSnapshot && JSON.stringify($form) !== initialSnapshot;
  }

  onMount(() => {
    // Pre-fill form explicitly (mirroring the server data) to ensure the $state
    // proxy is fully settled before snapshotting for dirty detection.
    const d = data.editForm.data;
    $form.id = d.id;
    $form.name = d.name ?? '';
    $form.type = d.type;
    $form.host = d.host;
    $form.port = d.port;
    $form.tls = d.tls;
    $form.accessStyle = d.accessStyle;
    $form.region = d.region;
    $form.credentials = { accessKey: d.credentials?.accessKey ?? '', secretKey: '' };

    initialSnapshot = JSON.stringify($form);
    loaded = true;
  });

  beforeNavigate(({ cancel: cancelNav, to }) => {
    if (!bypassDirtyCheck && isFormDirty() && to?.url) {
      cancelNav();
      pendingNavigation = to.url.pathname + to.url.search + to.url.hash;
      confirmLeaveOpen = true;
    }
  });

  function confirmLeave() {
    const dest = pendingNavigation!;
    confirmLeaveOpen = false;
    pendingNavigation = null;
    bypassDirtyCheck = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    goto(resolveRoute(dest as any));
  }

  function cancelLeave() {
    confirmLeaveOpen = false;
    pendingNavigation = null;
  }

  function handleBeforeUnload(e: BeforeUnloadEvent) {
    if (isFormDirty()) {
      e.preventDefault();
    }
  }

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

<svelte:window onbeforeunload={handleBeforeUnload} />

<Modal bind:open={confirmLeaveOpen} class="modal">
  <div class="modal-box">
    <h3 class="text-lg font-semibold">{m.storage_connection_edit_unsaved_title()}</h3>
    <p class="text-base-content/70 mt-2 text-sm">{m.storage_connection_edit_unsaved_body()}</p>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={cancelLeave}>
        {m.storage_connection_edit_unsaved_stay()}
      </button>
      <button type="button" class="btn btn-error" onclick={confirmLeave}>
        {m.storage_connection_edit_unsaved_leave()}
      </button>
    </div>
  </div>
</Modal>

<h1 class="mb-1 text-xl font-semibold">{m.storage_connection_edit_title()}</h1>

{#if !loaded}
  <div class="flex items-center justify-center py-12">
    <span class="loading loading-spinner loading-md text-base-content/40"></span>
  </div>
{:else}
  {#if isActiveConnection}
    <div role="note" class="alert alert-info mb-4 flex gap-2">
      <IconInfo class="size-5 shrink-0" aria-hidden="true" />
      <span class="text-sm">{m.storage_connection_edit_active_notice()}</span>
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
        class="input w-full"
        placeholder={m.storage_connection_edit_name_placeholder()}
        bind:value={$form.name}
      />
      <p class="text-base-content/50 mt-1 text-xs">{m.storage_connection_edit_name_hint()}</p>
    </div>

    <input type="hidden" name="type" value={$form.type} />

    <!-- Host -->
    <div>
      <label for="{uid}-host" class="label mb-1 text-sm font-medium">
        {m.storage_connect_host()}
      </label>
      <input
        id="{uid}-host"
        name="host"
        type="text"
        class={['input w-full', $errors?.host && 'input-error']}
        placeholder={m.storage_connect_host_placeholder()}
        bind:value={$form.host}
        onblur={parseHostInput}
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
        class={['input w-full', $errors?.port && 'input-error']}
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
        class="select w-full"
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
        class={['input w-full', $errors?.region?.name && 'input-error']}
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
        class={['input w-full', $errors?.credentials?.accessKey && 'input-error']}
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
        class={['input w-full', $errors?.credentials?.secretKey && 'input-error']}
        autocomplete="current-password"
        bind:value={$form.credentials.secretKey}
      />
      <p class="text-base-content/50 mt-1 text-xs">
        {m.storage_connection_edit_credentials_hint()}
      </p>
      {#if $errors?.credentials?.secretKey}
        <p class="text-error mt-1 text-xs">{$errors.credentials.secretKey}</p>
      {/if}
    </div>

    {#if $message && $message !== 'ok'}
      <p class="text-error text-sm">{$message}</p>
    {/if}

    <button type="submit" class="btn btn-primary self-start" disabled={$submitting}>
      {#if $submitting}
        <span class="loading loading-sm loading-spinner"></span>
      {/if}
      {m.storage_connection_edit_save()}
    </button>
  </form>

  <div class="mt-3 flex items-center gap-3">
    <a href={resolve('/settings/connections')} class="btn btn-ghost">
      ← {m.storage_connections_title()}
    </a>
  </div>
{/if}
