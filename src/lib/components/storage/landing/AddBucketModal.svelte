<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { getStorageState } from '$lib/storage/context.js';
  import { connectionStore } from '$lib/storage/connection-store.svelte.js';
  import { encodeContainerSegment } from '$lib/storage/display-helpers.js';
  import { normaliseHdfsBasePath } from '$lib/storage/hdfs-path.js';

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  const uid = $props.id();
  const storage = getStorageState();

  let bucketName = $state('');
  let submitting = $state(false);
  let error = $state<'invalid' | 'access_denied' | 'not_found' | 'unknown' | null>(null);

  const isHdfs = $derived(connectionStore.activeConnection?.type === 'hdfs');

  function reset() {
    bucketName = '';
    submitting = false;
    error = null;
  }

  function handleClose() {
    open = false;
  }

  // Reset form state whenever the modal is closed
  $effect(() => {
    if (!open) reset();
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const raw = bucketName.trim();
    if (!raw) return;
    const name = isHdfs ? normaliseHdfsBasePath(raw) : raw;
    if (!name) {
      error = 'invalid';
      return;
    }

    submitting = true;
    error = null;

    try {
      const result = await storage.api.checkBucket({ bucket: name });

      if (result.ok) {
        // Persist the bucket to the connection's additionalBuckets
        await storage.api.updateConnections({ bucket: name });

        // Update local store so the grid reflects the change
        const activeId = connectionStore.activeConnectionId;
        if (activeId) {
          const idx = connectionStore.connections.findIndex((c) => c.id === activeId);
          if (idx !== -1) {
            const updated = [...connectionStore.connections];
            updated[idx] = {
              ...updated[idx],
              additionalBuckets: [...updated[idx].additionalBuckets, name]
            };
            connectionStore.connections = updated;
          }
        }

        storage.addBucket(name);
        open = false;
        reset();
        await goto(
          resolve('/(app)/storage/browse/[connection]/[bucket]/[...prefix]', {
            connection: encodeURIComponent(storage.connectionHostname),
            bucket: encodeContainerSegment(name),
            prefix: ''
          })
        );
      } else if (result.status === 403) {
        error = 'access_denied';
      } else if (result.status === 404) {
        error = 'not_found';
      } else {
        error = 'unknown';
      }
    } catch {
      error = 'unknown';
    } finally {
      submitting = false;
    }
  }

  const errorMessage = $derived.by(() => {
    switch (error) {
      case 'invalid':
        return m.storage_add_path_error_invalid();
      case 'access_denied':
        return isHdfs
          ? m.storage_add_path_error_access_denied()
          : m.storage_add_bucket_error_access_denied();
      case 'not_found':
        return isHdfs
          ? m.storage_add_path_error_not_found()
          : m.storage_add_bucket_error_not_found();
      case 'unknown':
        return m.storage_add_bucket_error_unknown();
      default:
        return null;
    }
  });
</script>

<Modal bind:open class="modal">
  <div class="modal-box w-full max-w-sm">
    <h2 class="mb-1 text-lg font-semibold">
      {isHdfs ? m.storage_add_path_title() : m.storage_add_bucket_title()}
    </h2>
    <p class="text-base-content/60 mb-5 text-sm">
      {isHdfs ? m.storage_add_path_subtitle() : m.storage_add_bucket_subtitle()}
    </p>

    <form onsubmit={handleSubmit} class="flex flex-col gap-4">
      <div>
        <label for="{uid}-bucket-name" class="label mb-1 text-sm font-medium">
          {isHdfs ? m.storage_add_path_name_label() : m.storage_add_bucket_name_label()}
        </label>
        <input
          id="{uid}-bucket-name"
          type="text"
          class="input w-full {error ? 'input-error' : ''}"
          placeholder={isHdfs
            ? m.storage_add_path_name_placeholder()
            : m.storage_add_bucket_name_placeholder()}
          bind:value={bucketName}
          disabled={submitting}
          autocomplete="off"
          spellcheck="false"
        />
        {#if errorMessage}
          <p class="text-error mt-1 text-xs" role="alert">{errorMessage}</p>
        {/if}
      </div>

      <div class="modal-action mt-2">
        <button type="button" class="btn btn-ghost" onclick={handleClose} disabled={submitting}>
          {m.storage_add_bucket_cancel()}
        </button>
        <button type="submit" class="btn btn-primary" disabled={submitting || !bucketName.trim()}>
          {#if submitting}
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          {/if}
          {m.storage_add_bucket_submit()}
        </button>
      </div>
    </form>
  </div>
</Modal>
