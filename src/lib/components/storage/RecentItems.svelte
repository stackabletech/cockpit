<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '@iconify/svelte';
  import prettyBytes from 'pretty-bytes';
  import * as m from '$lib/paraglide/messages.js';
  import {
    recentFiles,
    recentLocations,
    fileName,
    fileLocation,
    locationName,
    locationPath,
    fileHref,
    locationHref
  } from '$lib/stores/recent-items.svelte.js';
  import PreviewModal from '$lib/components/storage/PreviewModal.svelte';
  import TimestampDisplay from '$lib/components/storage/TimestampDisplay.svelte';

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

{#snippet tabPanel(isEmpty: boolean, emptyMessage: string, tableContent: Snippet)}
  {#if isEmpty}
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
      {#each recentFiles as file (file.bucket + '::' + file.key)}
        <tr class="hover">
          <td>
            <div class="flex items-center gap-2">
              <Icon
                icon="material-symbols:description-outline"
                class="text-primary size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="font-medium">{fileName(file.key)}</span>
            </div>
          </td>
          <td>
            <span class="text-base-content/60 truncate text-xs">
              {fileLocation(file)}
            </span>
          </td>
          <td class="text-base-content/60 text-xs whitespace-nowrap">
            {prettyBytes(file.size)}
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
                  <Icon
                    icon="material-symbols:preview-outline"
                    class="size-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div class="tooltip tooltip-left" data-tip={m.storage_recent_open_folder()}>
                <a
                  href={fileHref(file)}
                  data-sveltekit-preload-data="off"
                  class="btn btn-ghost btn-xs"
                  aria-label="{m.storage_recent_open_folder()} — {fileName(file.key)}"
                >
                  <Icon
                    icon="material-symbols:folder-open-outline"
                    class="size-3.5"
                    aria-hidden="true"
                  />
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
      {#each recentLocations as loc (loc.bucket + '::' + loc.prefix)}
        <tr class="hover">
          <td>
            <div class="flex items-center gap-2">
              {#if loc.prefix === ''}
                <Icon
                  icon="mdi:bucket-outline"
                  class="text-warning size-4 shrink-0"
                  aria-hidden="true"
                />
              {:else}
                <Icon
                  icon="material-symbols:folder-outline"
                  class="text-warning size-4 shrink-0"
                  aria-hidden="true"
                />
              {/if}
              <a
                href={locationHref(loc)}
                data-sveltekit-preload-data="off"
                class="hover:text-primary font-medium">{locationName(loc)}</a
              >
            </div>
          </td>
          <td>
            <span class="text-base-content/60 truncate text-xs">
              {locationPath(loc)}
            </span>
          </td>
          <td class="text-base-content/50 text-xs whitespace-nowrap">
            <TimestampDisplay date={loc.visitedAt} relative tooltip="tooltip-left" />
          </td>
          <td>
            <div class="tooltip tooltip-left" data-tip={m.storage_recent_go_to_location()}>
              <a
                href={locationHref(loc)}
                data-sveltekit-preload-data="off"
                class="btn btn-ghost btn-xs"
                aria-label="{m.storage_recent_go_to_location()} — {locationName(loc)}"
              >
                <Icon icon="material-symbols:arrow-forward" class="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<section class="mt-8 flex min-h-0 flex-1 flex-col">
  <!-- Tab header -->
  <div role="tablist" class="tabs tabs-border mb-0">
    <button
      role="tab"
      class="tab {activeTab === 'files' ? 'tab-active' : ''}"
      aria-selected={activeTab === 'files'}
      onclick={() => (activeTab = 'files')}
    >
      {m.storage_recent_files()}
    </button>
    <button
      role="tab"
      class="tab {activeTab === 'locations' ? 'tab-active' : ''}"
      aria-selected={activeTab === 'locations'}
      onclick={() => (activeTab = 'locations')}
    >
      {m.storage_recent_locations()}
    </button>
  </div>

  <div class="border-base-300 min-h-0 flex-1 overflow-y-auto rounded-tr-lg rounded-b-lg border">
    {#if activeTab === 'files'}
      {@render tabPanel(recentFiles.length === 0, m.storage_recent_empty_files(), filesTable)}
    {:else}
      {@render tabPanel(
        recentLocations.length === 0,
        m.storage_recent_empty_locations(),
        locationsTable
      )}
    {/if}
  </div>
</section>

<PreviewModal bind:open={showPreviewModal} bucket={previewBucket} objectKey={previewKey} />
