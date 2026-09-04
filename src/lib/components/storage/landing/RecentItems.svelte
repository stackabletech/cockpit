<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolveRoute } from '$app/paths';
  import IconArrowForward from 'virtual:icons/material-symbols/arrow-forward';
  import IconDescriptionOutline from 'virtual:icons/material-symbols/description-outline';
  import IconPreviewOutline from 'virtual:icons/material-symbols/preview-outline';
  import IconFolderOpenOutline from 'virtual:icons/material-symbols/folder-open-outline';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconFolderOutline from 'virtual:icons/material-symbols/folder-outline';
  import * as m from '$lib/paraglide/messages.js';
  import { formatFileSize } from '$lib/storage/utils.js';
  import { getStorageState } from '$lib/storage/context.js';
  import {
    fileName,
    fileHref,
    fileLocation,
    locationHref,
    locationName,
    locationPath
  } from '$lib/storage/display-helpers.js';
  import PreviewModal from '$lib/components/storage/modals/PreviewModal.svelte';
  import TimestampDisplay from '$lib/components/storage/shared/TimestampDisplay.svelte';

  interface Props {
    loading?: boolean;
  }

  let { loading = false }: Props = $props();

  const storage = getStorageState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rr = (p: string) => resolveRoute(p as any);

  type Tab = 'files' | 'locations';
  let activeTab = $state<Tab>('files');

  let showPreviewModal = $state(false);
  let previewBucket = $state('');
  let previewKey = $state<string | null>(null);

  function openPreview(bucket: string, key: string) {
    previewBucket = bucket;
    previewKey = key;
    showPreviewModal = true;
  }
</script>

{#snippet skeletonRows()}
  <table class="table-sm table w-full">
    <thead>
      <tr>
        {#if activeTab === 'files'}
          <th>{m.storage_recent_col_name()}</th>
          <th>{m.storage_recent_col_location()}</th>
          <th>{m.storage_recent_col_size()}</th>
          <th>{m.storage_recent_col_visited()}</th>
          <th class="w-16">{m.storage_recent_col_actions()}</th>
        {:else}
          <th>{m.storage_recent_col_name()}</th>
          <th>{m.storage_recent_col_path()}</th>
          <th>{m.storage_recent_col_visited()}</th>
          <th class="w-16">{m.storage_recent_col_actions()}</th>
        {/if}
      </tr>
    </thead>
    <tbody>
      <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
      {#each [1, 2, 3, 4] as _, i (i)}
        <tr>
          <td>
            <div class="flex items-center gap-2">
              <div class="skeleton size-4 animate-pulse rounded" aria-hidden="true"></div>
              <div class="skeleton h-4 w-32 animate-pulse rounded" aria-hidden="true"></div>
            </div>
          </td>
          <td>
            <div class="skeleton h-4 w-48 animate-pulse rounded" aria-hidden="true"></div>
          </td>
          {#if activeTab === 'files'}
            <td>
              <div class="skeleton h-4 w-16 animate-pulse rounded" aria-hidden="true"></div>
            </td>
          {/if}
          <td>
            <div class="skeleton h-4 w-24 animate-pulse rounded" aria-hidden="true"></div>
          </td>
          <td>
            <div class="flex items-center gap-1">
              <div class="skeleton size-6 animate-pulse rounded" aria-hidden="true"></div>
              <div class="skeleton size-6 animate-pulse rounded" aria-hidden="true"></div>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet tabPanel(isEmpty: boolean, emptyMessage: string, tableContent: Snippet)}
  {#if loading}
    <div class="overflow-x-auto" aria-label={m.storage_loading()}>
      {@render skeletonRows()}
    </div>
  {:else if isEmpty}
    <p class="text-base-content/40 px-4 py-8 text-center text-sm">{emptyMessage}</p>
  {:else}
    <div class="overflow-x-auto">
      {@render tableContent()}
    </div>
  {/if}
{/snippet}

{#snippet filesTable()}
  <table class="table-sm table w-full">
    <thead>
      <tr>
        <th>{m.storage_recent_col_name()}</th>
        <th>{m.storage_recent_col_location()}</th>
        <th>{m.storage_recent_col_size()}</th>
        <th>{m.storage_recent_col_visited()}</th>
        <th class="w-16">{m.storage_recent_col_actions()}</th>
      </tr>
    </thead>
    <tbody>
      {#each storage.bookmarks.recentFiles as file (file.bucket + '::' + file.key)}
        <tr>
          <td>
            <div class="flex items-center gap-2">
              <IconDescriptionOutline class="text-primary size-4 shrink-0" aria-hidden="true" />
              <span class="font-medium">{fileName(file.key)}</span>
            </div>
          </td>
          <td>
            <a
              href={rr(fileHref(storage.connectionHostname, file))}
              data-sveltekit-preload-data="off"
              class="text-base-content/60 hover:text-primary truncate text-xs"
            >
              {fileLocation(file)}
            </a>
          </td>
          <td class="text-base-content/60 text-xs whitespace-nowrap">
            {formatFileSize(file.size)}
          </td>
          <td class="text-base-content/50 text-xs whitespace-nowrap">
            <TimestampDisplay date={file.visitedAt} relative tooltip="tooltip-left" />
          </td>
          <td>
            <div class="flex items-center gap-1">
              <div class="tooltip tooltip-left" data-tip={m.storage_recent_preview_file()}>
                <button
                  class="btn btn-ghost btn-xs"
                  aria-label="{m.storage_recent_preview_file()} — {fileName(file.key)}"
                  onclick={() => openPreview(file.bucket, file.key)}
                >
                  <IconPreviewOutline class="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <div class="tooltip tooltip-left" data-tip={m.storage_recent_open_folder()}>
                <a
                  href={rr(fileHref(storage.connectionHostname, file))}
                  data-sveltekit-preload-data="off"
                  class="btn btn-ghost btn-xs"
                  aria-label="{m.storage_recent_open_folder()} — {fileName(file.key)}"
                >
                  <IconFolderOpenOutline class="size-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet locationsTable()}
  <table class="table-sm table w-full">
    <thead>
      <tr>
        <th>{m.storage_recent_col_name()}</th>
        <th>{m.storage_recent_col_path()}</th>
        <th>{m.storage_recent_col_visited()}</th>
        <th class="w-16">{m.storage_recent_col_actions()}</th>
      </tr>
    </thead>
    <tbody>
      {#each storage.bookmarks.recentLocations as loc (loc.bucket + '::' + loc.prefix)}
        <tr>
          <td>
            <div class="flex items-center gap-2">
              {#if loc.prefix === ''}
                <IconStorage class="text-warning size-4 shrink-0" aria-hidden="true" />
              {:else}
                <IconFolderOutline class="text-warning size-4 shrink-0" aria-hidden="true" />
              {/if}
              <a
                href={rr(locationHref(storage.connectionHostname, loc))}
                data-sveltekit-preload-data="off"
                class="hover:text-primary font-medium">{locationName(loc)}</a
              >
            </div>
          </td>
          <td>
            <a
              href={rr(locationHref(storage.connectionHostname, loc))}
              data-sveltekit-preload-data="off"
              class="text-base-content/60 hover:text-primary truncate text-xs"
            >
              {locationPath(loc)}
            </a>
          </td>
          <td class="text-base-content/50 text-xs whitespace-nowrap">
            <TimestampDisplay date={loc.visitedAt} relative tooltip="tooltip-left" />
          </td>
          <td>
            <div class="tooltip tooltip-left" data-tip={m.storage_recent_go_to_location()}>
              <a
                href={rr(locationHref(storage.connectionHostname, loc))}
                data-sveltekit-preload-data="off"
                class="btn btn-ghost btn-xs"
                aria-label="{m.storage_recent_go_to_location()} — {locationName(loc)}"
              >
                <IconArrowForward class="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<section class="card bg-base-100 border-base-300 mt-8 flex min-h-0 flex-1 flex-col border">
  <!-- Tab header -->
  <div role="tablist" class="tabs tabs-border mb-0">
    <button
      type="button"
      role="tab"
      class="tab {activeTab === 'files' ? 'tab-active' : ''}"
      aria-selected={activeTab === 'files'}
      onclick={() => (activeTab = 'files')}
    >
      {m.storage_recent_files()}
    </button>
    <button
      type="button"
      role="tab"
      class="tab {activeTab === 'locations' ? 'tab-active' : ''}"
      aria-selected={activeTab === 'locations'}
      onclick={() => (activeTab = 'locations')}
    >
      {m.storage_recent_locations()}
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if activeTab === 'files'}
      {@render tabPanel(
        storage.bookmarks.recentFiles.length === 0,
        m.storage_recent_empty_files(),
        filesTable
      )}
    {:else}
      {@render tabPanel(
        storage.bookmarks.recentLocations.length === 0,
        m.storage_recent_empty_locations(),
        locationsTable
      )}
    {/if}
  </div>
</section>

<PreviewModal bind:open={showPreviewModal} bucket={previewBucket} objectKey={previewKey} />
