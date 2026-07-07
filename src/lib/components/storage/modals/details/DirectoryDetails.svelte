<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import IconCalculate from 'virtual:icons/material-symbols/calculate';
  import IconFolderOpen from 'virtual:icons/material-symbols/folder-open';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import { formatFileSize } from '$lib/storage/utils.js';
  import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
  import type {
    DirectorySizeEvent,
    TreemapNode
  } from '$lib/storage/details-types.js';
  import Treemap from './Treemap.svelte';

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
  let result = $state<{ totalSize: number; totalKeys: number; tree: TreemapNode; durationMs: number } | null>(null);

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

  {#if !result && !calculating && !error}
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
          <p class="text-base-content/80">{m.storage_details_keys_found({ count: progress.keysFound })}</p>
          <p class="text-base-content/60 font-mono">{formatFileSize(progress.totalSize)}</p>
        </div>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="border-error/40 bg-error/10 flex items-center gap-3 rounded-lg border p-4" role="alert">
      <IconWarning class="text-error size-5 shrink-0" aria-hidden="true" />
      <p class="text-sm">{error}</p>
    </div>
  {/if}

  {#if result}
    <div class="flex gap-6">
      <div class="stats">
        <div class="stat">
          <div class="stat-title">{m.storage_details_total_size()}</div>
          <div class="stat-value text-lg">{formatFileSize(result.totalSize)}</div>
        </div>
        <div class="stat">
          <div class="stat-title">{m.storage_details_keys_found({ count: result.totalKeys })}</div>
          <div class="stat-value text-lg">{result.totalKeys.toLocaleString()}</div>
        </div>
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
