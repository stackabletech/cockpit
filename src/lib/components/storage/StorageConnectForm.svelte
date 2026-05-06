<script lang="ts">
  import type { SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4 as zod } from 'sveltekit-superforms/adapters';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageConnectionSchema } from '$lib/schemas/storage.js';
  import type { z } from 'zod';

  interface Props {
    connectionForm: SuperValidated<z.infer<typeof StorageConnectionSchema>, string>;
  }

  let { connectionForm }: Props = $props();

  const uid = $props.id();

  const { form, errors, enhance, submitting, message } = superForm(connectionForm, {
    validators: zod(StorageConnectionSchema)
  });
</script>

<div class="mx-auto max-w-md p-6">
  <h1 class="mb-1 text-xl font-semibold">{m.storage_connect_title()}</h1>
  <p class="text-base-content/60 mb-6 text-sm">{m.storage_connect_subtitle()}</p>

  <form
    method="POST"
    action="?/connect"
    use:enhance
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
          {$errors.endpoint ? 'input-error' : ''}"
        placeholder={m.storage_connect_endpoint_placeholder()}
        bind:value={$form.endpoint}
      />
      <p class="text-base-content/50 mt-1 text-xs">{m.storage_connect_endpoint_hint()}</p>
      {#if $errors.endpoint}
        <p class="text-error mt-1 text-xs">{$errors.endpoint}</p>
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
          {$errors.region ? 'input-error' : ''}"
        bind:value={$form.region}
      />
      {#if $errors.region}
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
        class="
          input-bordered input w-full
          {$errors.accessKeyId ? 'input-error' : ''}"
        autocomplete="username"
        bind:value={$form.accessKeyId}
      />
      {#if $errors.accessKeyId}
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
        class="
          input-bordered input w-full
          {$errors.secretAccessKey ? `input-error` : ''}"
        autocomplete="current-password"
        bind:value={$form.secretAccessKey}
      />
      {#if $errors.secretAccessKey}
        <p class="text-error mt-1 text-xs">{$errors.secretAccessKey}</p>
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
