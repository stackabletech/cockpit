<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconOpenInFull from 'virtual:icons/material-symbols/open-in-full';
  import IconCloseFullscreen from 'virtual:icons/material-symbols/close-fullscreen';
  import IconDescription from 'virtual:icons/material-symbols/description';
  import IconFolder from 'virtual:icons/material-symbols/folder';
  import IconBucket from '$lib/components/storage/shared/BucketIcon.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { connectionStore } from '$lib/storage/connection-store.svelte.js';
  import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
  import type { FileDetails as FileDetailsType } from '$lib/storage/details-types.js';
  import FileDetails from './details/FileDetails.svelte';
  import DirectoryDetails from './details/DirectoryDetails.svelte';
  import BucketDetails from './details/BucketDetails.svelte';

  interface Props {
    open: boolean;
    type: 'file' | 'directory' | 'bucket';
    bucket: string;
    key?: string;
    prefix?: string;
  }

  let { open = $bindable(), type, bucket, key, prefix }: Props = $props();

  let maximized = $state(false);

  // Reset maximized state when the modal closes
  $effect(() => {
    if (!open) maximized = false;
  });

  let fileDetails = $state<FileDetailsType | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  const title = $derived(
    type === 'file'
      ? m.storage_details_file_title()
      : type === 'directory'
        ? m.storage_details_folder_title()
        : m.storage_details_bucket_title()
  );

  const iconColor = $derived(type === 'file' ? 'text-info' : 'text-warning');

  async function loadFileDetails() {
    if (type !== 'file' || !key) return;
    loading = true;
    loadError = null;
    try {
      const connectionId = connectionStore.activeConnectionId;
      if (!connectionId) {
        loadError = m.storage_details_error_not_connected();
        return;
      }
      const params = new URLSearchParams({ bucket, key });
      const res = await fetch(`/api/storage/details?${params}`, {
        headers: { [STORAGE_CONNECTION_ID_HEADER]: connectionId }
      });
      if (!res.ok) {
        loadError = m.storage_details_error_fetch_file({ status: res.status });
        return;
      }
      fileDetails = (await res.json()) as FileDetailsType;
    } catch (err) {
      loadError = err instanceof Error ? err.message : m.storage_details_error_unknown();
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open && type === 'file') {
      void loadFileDetails();
    }
  });
</script>

<Modal bind:open class="modal">
  <div
    class="modal-box transition-all duration-200 {maximized
      ? 'h-[90vh] w-[95vw] max-w-none'
      : 'max-w-2xl'}"
  >
    <div class="mb-4 flex items-start justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="{iconColor} bg-base-200 flex size-10 items-center justify-center rounded-lg">
          {#if type === 'file'}
            <IconDescription class="size-5" />
          {:else if type === 'directory'}
            <IconFolder class="size-5" />
          {:else}
            <IconBucket class="size-5" />
          {/if}
        </div>
        <div class="min-w-0">
          <h3 class="text-lg font-bold">{title}</h3>
          <p class="text-base-content/50 truncate text-sm">
            {type === 'bucket' ? bucket : (key ?? prefix ?? '')}
          </p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={() => (maximized = !maximized)}
          aria-label={maximized ? m.storage_details_restore() : m.storage_details_maximise()}
          title={maximized ? m.storage_details_restore() : m.storage_details_maximise()}
        >
          {#if maximized}
            <IconCloseFullscreen class="size-4" aria-hidden="true" />
          {:else}
            <IconOpenInFull class="size-4" aria-hidden="true" />
          {/if}
        </button>
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={() => (open = false)}
          aria-label={m.storage_details_close()}
        >
          <IconClose class="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>

    {#if loading && type === 'file'}
      <div class="flex items-center justify-center py-8">
        <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
      </div>
    {/if}

    {#if loadError}
      <div class="text-error-content bg-error/10 rounded-box border-error/40 border p-4 text-sm">
        {loadError}
      </div>
    {/if}

    {#if !loading && !loadError}
      {#if type === 'file' && fileDetails}
        <FileDetails details={fileDetails} {bucket} />
      {:else if type === 'directory'}
        <DirectoryDetails key={key ?? prefix ?? ''} {bucket} {maximized} />
      {:else if type === 'bucket'}
        <BucketDetails {bucket} />
      {/if}
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost" onclick={() => (open = false)}>
        {m.storage_details_close()}
      </button>
    </div>
  </div>
</Modal>
