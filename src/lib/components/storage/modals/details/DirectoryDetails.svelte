<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import IconCalculate from 'virtual:icons/material-symbols/calculate';
  import IconFolderOpen from 'virtual:icons/material-symbols/folder-open';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import { formatFileSize, keyToName } from '$lib/storage/utils.js';
  import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
  import type {
    DirectorySizeEvent,
    DirectoryMetadata,
    TreemapNode
  } from '$lib/storage/details-types.js';
  import Treemap from './Treemap.svelte';
  import { getLocale } from '$lib/paraglide/runtime';

  interface Props {
    key: string;
    bucket: string;
  }

  let { key: objectKey, bucket }: Props = $props();

  const prefix = $derived(objectKey.endsWith('/') ? objectKey : objectKey + '/');
  const name = $derived(objectKey.split('/').filter(Boolean).pop() ?? objectKey);

  let calculating = $state(false);
  let error = $state<string | null>(null);
  let progress = $state<{ keysFound: number; totalSize: number } | null>(null);
  let result = $state<{
    totalSize: number;
    totalKeys: number;
    totalFiles: number;
    totalDirectories: number;
    tree: TreemapNode;
    durationMs: number;
  } | null>(null);

  let meta = $state<DirectoryMetadata | null>(null);
  let metaError = $state<string | null>(null);

  async function fetchMetadata() {
    try {
      const conn = loadConnectionLocally();
      if (!conn) return;
      const connHeader = getConnectionHeader(conn);
      const params = new URLSearchParams({ bucket, prefix });
      const res = await fetch(`/api/storage/directory-metadata?${params}`, {
        headers: { 'x-storage-connection': connHeader }
      });
      if (!res.ok) {
        metaError = `Failed to fetch directory metadata (${res.status})`;
        return;
      }
      meta = await res.json();
    } catch (err) {
      metaError = err instanceof Error ? err.message : 'Unknown error';
    }
  }

  $effect(() => {
    void fetchMetadata();
  });

  async function calculateSize() {
    calculating = true;
    error = null;
    progress = null;
    result = null;

    try {
      const conn = loadConnectionLocally();
      if (!conn) {
        error = 'No storage connection configured';
        calculating = false;
        return;
      }
      const connHeader = getConnectionHeader(conn);
      const params = new URLSearchParams({ bucket, prefix });
      const res = await fetch(`/api/storage/directory-size?${params}`, {
        headers: { 'x-storage-connection': connHeader }
      });

      if (!res.ok) {
        error = `Failed to calculate directory size (${res.status})`;
        calculating = false;
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        error = 'No response body';
        calculating = false;
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as DirectorySizeEvent;
            if (event.type === 'progress') {
              progress = { keysFound: event.keysFound, totalSize: event.totalSize };
            } else if (event.type === 'complete') {
              result = {
                totalSize: event.totalSize,
                totalKeys: event.totalKeys,
                totalFiles: event.totalFiles,
                totalDirectories: event.totalDirectories,
                tree: event.tree,
                durationMs: event.durationMs
              };
            } else if (event.type === 'error') {
              error = event.message;
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      calculating = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center gap-3">
    <IconFolderOpen class="text-warning size-8 shrink-0" aria-hidden="true" />
    <div class="min-w-0">
      <p class="truncate font-medium">{name}</p>
      <p class="text-base-content/50 text-xs">s3://{bucket}/{prefix}</p>
    </div>
  </div>

  {#if meta}
    {#if meta.markerExists || meta.bucketOwner || (meta.bucketGrants && meta.bucketGrants.length > 0)}
      <div class="border-base-300 rounded-box border p-3">
        {#if meta.markerExists}
          <div class="flex items-center gap-2 text-sm">
            <span class="text-base-content/60 font-medium"
              >{m.storage_details_marker_exists()}:</span
            >
            <span class="font-mono text-xs">{keyToName(prefix)}</span>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {#if meta.markerLastModified}
              <span class="text-base-content/60">{m.storage_details_last_modified()}</span>
              <span class="font-mono"
                >{new Date(meta.markerLastModified).toLocaleString(getLocale())}</span
              >
            {/if}
            {#if meta.markerStorageClass}
              <span class="text-base-content/60">{m.storage_details_storage_class()}</span>
              <span class="font-mono">{meta.markerStorageClass}</span>
            {/if}
            {#if meta.markerVersionId}
              <span class="text-base-content/60">{m.storage_details_version_id()}</span>
              <span class="truncate font-mono" title={meta.markerVersionId}
                >{meta.markerVersionId.slice(0, 20)}...</span
              >
            {/if}
            {#if meta.markerServerSideEncryption}
              <span class="text-base-content/60">{m.storage_details_encryption()}</span>
              <span class="font-mono">{meta.markerServerSideEncryption}</span>
            {/if}
            {#if meta.markerObjectLockMode}
              <span class="text-base-content/60">{m.storage_details_object_lock_mode()}</span>
              <span class="font-mono">{meta.markerObjectLockMode}</span>
            {/if}
            {#if meta.markerObjectLockRetainUntilDate}
              <span class="text-base-content/60">{m.storage_details_object_lock_until()}</span>
              <span class="font-mono"
                >{new Date(meta.markerObjectLockRetainUntilDate).toLocaleString(getLocale())}</span
              >
            {/if}
          </div>
        {:else if !meta.markerExists}
          <p class="text-base-content/40 text-xs italic">{m.storage_details_marker_none()}</p>
        {/if}
        <div class="mt-2 flex items-center gap-2 text-sm">
          <span class="text-base-content/60 font-medium">{m.storage_details_owner()}:</span>
          <span class="font-mono text-xs">{meta.bucketOwner}</span>
        </div>
        {#if meta.bucketGrants && meta.bucketGrants.length > 0}
          <div class="mt-2">
            <span class="text-base-content/60 text-xs font-medium"
              >{m.storage_details_permissions()}:</span
            >
            <div class="mt-1 flex flex-wrap gap-1">
              {#each meta.bucketGrants as grant (grant.grantee + '-' + grant.permission)}
                <span class="badge badge-sm gap-1 font-mono text-[10px]">
                  <span class="text-base-content/70">{grant.grantee}</span>
                  <span class="text-base-content/40">|</span>
                  <span>{grant.permission}</span>
                </span>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {:else if metaError}
    <div
      class="border-error/40 bg-error/10 flex items-center gap-3 rounded-lg border p-3"
      role="alert"
    >
      <IconWarning class="text-error size-4 shrink-0" aria-hidden="true" />
      <p class="text-xs">{metaError}</p>
    </div>
  {:else}
    <div class="border-base-300 rounded-box flex items-center justify-center border p-4">
      <span class="loading loading-spinner loading-sm text-primary" aria-hidden="true"></span>
    </div>
  {/if}

  {#if !result && !calculating}
    <button class="btn btn-outline btn-primary gap-2" onclick={calculateSize}>
      <IconCalculate class="size-4" aria-hidden="true" />
      {m.storage_details_calculate_size()}
    </button>
  {/if}

  {#if calculating}
    <div class="border-base-300 rounded-box flex flex-col items-center gap-3 border p-6">
      <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
      <p class="font-medium">{m.storage_details_calculating()}</p>
      <p class="text-base-content/60 text-sm">{m.storage_details_calculating_desc()}</p>
      {#if progress}
        <div class="text-center text-sm">
          <p class="text-base-content/80">
            {m.storage_details_keys_found({ count: progress.keysFound })}
          </p>
          <p class="text-base-content/60 font-mono">
            {formatFileSize(progress.totalSize)}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  {#if error}
    <div
      class="border-error/40 bg-error/10 flex items-center gap-3 rounded-lg border p-4"
      role="alert"
    >
      <IconWarning class="text-error size-5 shrink-0" aria-hidden="true" />
      <p class="text-sm">{error}</p>
    </div>
  {/if}

  {#if result}
    <div class="flex flex-wrap gap-6">
      <div class="stats">
        <div class="stat">
          <div class="stat-title">{m.storage_details_total_size()}</div>
          <div class="stat-value text-lg">{formatFileSize(result.totalSize)}</div>
        </div>
        <div class="stat">
          <div class="stat-title">{m.storage_details_file_count({ count: result.totalFiles })}</div>
          <div class="stat-value text-lg">{result.totalFiles.toLocaleString(getLocale())}</div>
        </div>
        {#if result.totalDirectories > 0}
          <div class="stat">
            <div class="stat-title">
              {m.storage_details_folder_count({ count: result.totalDirectories })}
            </div>
            <div class="stat-value text-lg">
              {result.totalDirectories.toLocaleString(getLocale())}
            </div>
          </div>
        {/if}
      </div>
    </div>

    {#if result.tree.children && result.tree.children.length > 0}
      <div>
        <h4 class="text-base-content/70 mb-2 text-xs font-semibold tracking-wide uppercase">
          {m.storage_details_tree_visualization()}
        </h4>
        <Treemap data={result.tree} />
      </div>
    {/if}
  {/if}
</div>
