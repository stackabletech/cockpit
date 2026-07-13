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
    DirectoryChildItem,
    TreemapNode
  } from '$lib/storage/details-types.js';
  import Treemap from './Treemap.svelte';
  import DirectorySizeList from './DirectorySizeList.svelte';
  import TimestampDisplay from '$lib/components/storage/shared/TimestampDisplay.svelte';
  import { getLocale } from '$lib/paraglide/runtime';

  interface Props {
    key: string;
    bucket: string;
  }

  let { key: objectKey, bucket }: Props = $props();

  const prefix = $derived(objectKey.endsWith('/') ? objectKey : objectKey + '/');
  const name = $derived(objectKey.split('/').filter(Boolean).pop() ?? objectKey);

  let tab: 'composition' | 'contents' = $state('composition');
  let depth = $state(1);
  let calculating = $state(false);
  let error = $state<string | null>(null);
  let progress = $state<{ keysFound: number; totalSize: number } | null>(null);
  let result = $state<{
    totalSize: number;
    totalKeys: number;
    totalFiles: number;
    totalDirectories: number;
    tree: TreemapNode;
    childrenByDepth: Record<number, DirectoryChildItem[]>;
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
        metaError = m.storage_details_error_fetch_dir_meta({ status: res.status });
        return;
      }
      meta = await res.json();
    } catch (err) {
      metaError = err instanceof Error ? err.message : m.storage_details_error_unknown();
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
        error = m.storage_details_error_not_connected();
        calculating = false;
        return;
      }
      const connHeader = getConnectionHeader(conn);
      const params = new URLSearchParams({ bucket, prefix });
      const res = await fetch(`/api/storage/directory-size?${params}`, {
        headers: { 'x-storage-connection': connHeader }
      });

      if (!res.ok) {
        error = m.storage_details_error_calc_size({ status: res.status });
        calculating = false;
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        error = m.storage_details_error_no_body();
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
                childrenByDepth: event.childrenByDepth,
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
      error = err instanceof Error ? err.message : m.storage_details_error_unknown();
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
    <div class="overflow-x-auto">
      <table class="table-sm table">
        <tbody>
          {#if meta.markerExists}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_marker_exists()}</td
              >
              <td class="font-mono text-sm">{keyToName(prefix)}</td>
            </tr>
          {:else}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_marker_exists()}</td
              >
              <td class="text-base-content/40 text-sm italic">{m.storage_details_marker_none()}</td>
            </tr>
          {/if}
          {#if meta.markerLastModified}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_last_modified()}</td
              >
              <td><TimestampDisplay date={meta.markerLastModified} /></td>
            </tr>
          {/if}
          {#if meta.markerStorageClass}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_storage_class()}</td
              >
              <td class="font-mono text-sm">{meta.markerStorageClass}</td>
            </tr>
          {/if}
          {#if meta.markerVersionId}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_version_id()}</td
              >
              <td class="max-w-xs truncate font-mono text-sm" title={meta.markerVersionId}
                >{meta.markerVersionId.slice(0, 20)}...</td
              >
            </tr>
          {/if}
          {#if meta.markerServerSideEncryption}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_encryption()}</td
              >
              <td class="font-mono text-sm">{meta.markerServerSideEncryption}</td>
            </tr>
          {/if}
          {#if meta.markerObjectLockMode}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_object_lock_mode()}</td
              >
              <td class="font-mono text-sm">{meta.markerObjectLockMode}</td>
            </tr>
          {/if}
          {#if meta.markerObjectLockRetainUntilDate}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_object_lock_until()}</td
              >
              <td><TimestampDisplay date={meta.markerObjectLockRetainUntilDate} /></td>
            </tr>
          {/if}
          <tr>
            <td class="text-base-content/60 font-medium whitespace-nowrap"
              >{m.storage_details_owner()}</td
            >
            <td class="font-mono text-sm">{meta.bucketOwner}</td>
          </tr>
          {#if meta.bucketGrants && meta.bucketGrants.length > 0}
            <tr>
              <td class="text-base-content/60 font-medium whitespace-nowrap"
                >{m.storage_details_permissions()}</td
              >
              <td>
                <div class="flex flex-wrap gap-1">
                  {#each meta.bucketGrants as grant (grant.grantee + '-' + grant.permission)}
                    <span class="badge badge-sm gap-1 font-mono text-[10px]">
                      <span class="text-base-content/70">{grant.grantee}</span>
                      <span class="text-base-content/40">|</span>
                      <span>{grant.permission}</span>
                    </span>
                  {/each}
                </div>
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
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
      <div class="bg-base-200 border-base-300 rounded-t-box flex gap-0 border-b" role="tablist">
        <button
          class="rounded-ss-box relative flex-1 px-4 py-2.5 text-sm font-medium transition-colors {tab ===
          'composition'
            ? 'bg-base-100 text-primary'
            : 'text-base-content/60 hover:bg-base-100/50 hover:text-base-content'}"
          role="tab"
          aria-selected={tab === 'composition'}
          onclick={() => (tab = 'composition')}
        >
          {m.storage_details_tab_composition()}
          {#if tab === 'composition'}
            <span class="bg-primary absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true"></span>
          {/if}
        </button>
        <button
          class="rounded-se-box relative flex-1 px-4 py-2.5 text-sm font-medium transition-colors {tab ===
          'contents'
            ? 'bg-base-100 text-primary'
            : 'text-base-content/60 hover:bg-base-100/50 hover:text-base-content'}"
          role="tab"
          aria-selected={tab === 'contents'}
          onclick={() => (tab = 'contents')}
        >
          {m.storage_details_tab_contents()}
          {#if tab === 'contents'}
            <span class="bg-primary absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true"></span>
          {/if}
        </button>
      </div>
      <div class={tab === 'composition' ? 'block' : 'hidden'}>
        <Treemap data={result.tree} />
      </div>
      <div class={tab === 'contents' ? 'block' : 'hidden'}>
        <div class="border-base-300 flex items-center gap-2 border-b px-3 py-2">
          <label for="depth-select" class="text-base-content/60 text-xs font-medium"
            >{m.storage_details_depth()}:
          </label>
          <select id="depth-select" class="select select-xs w-20" bind:value={depth}>
            {#each [1, 2, 3, 4, 5] as d (d)}
              <option value={d}>{d}</option>
            {/each}
          </select>
        </div>
        <DirectorySizeList items={result.childrenByDepth[depth] ?? []} />
      </div>
    {/if}
  {/if}
</div>
