<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { DownloadHistoryEntry } from '$lib/storage/api.js';
  import { SvelteSet } from 'svelte/reactivity';
  import { selectedDownloadHistoryPayloadSize } from '$lib/storage/download-history.js';
  import { formatFileSize } from '$lib/storage/utils.js';

  interface Props {
    entries: DownloadHistoryEntry[];
    onDownload: (id: string, keys: string[]) => Promise<void>;
  }

  let { entries, onDownload }: Props = $props();
  const uid = $props.id();
  let expanded = $state<Record<string, boolean>>({});
  let selected = $state<Record<string, string[]>>({});
  let downloading = $state<string | null>(null);

  function toggleDetails(id: string): void {
    expanded = { ...expanded, [id]: !expanded[id] };
  }

  function toggleKey(id: string, key: string, checked: boolean): void {
    const keys = new SvelteSet(selected[id] ?? []);
    if (checked) keys.add(key);
    else keys.delete(key);
    selected = { ...selected, [id]: [...keys] };
  }

  async function download(id: string, keys: string[]): Promise<void> {
    downloading = id;
    try {
      await onDownload(id, keys);
    } finally {
      downloading = null;
    }
  }
</script>

<section class="border-base-300 border-t px-3 py-3" aria-label={m.storage_download_history_title()}>
  <h2 class="text-base-content/50 mb-2 text-[10px] font-semibold tracking-widest uppercase">
    {m.storage_download_history_title()}
  </h2>
  {#if entries.length === 0}
    <p class="text-base-content/50 text-xs">{m.storage_download_history_empty()}</p>
  {:else}
    <ul class="space-y-2">
      {#each entries as entry (entry.id)}
        {@const chosen = selected[entry.id] ?? []}
        {@const totalSize = entry.entries.reduce((total, item) => total + item.size, 0)}
        {@const selectedSize = selectedDownloadHistoryPayloadSize(entry.entries, chosen)}
        <li class="bg-base-200 rounded-lg p-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-base-content truncate text-xs font-medium">{entry.bucket}</p>
              <p class="text-base-content/60 text-[10px]">
                {new Date(entry.createdAt).toLocaleString()} · {m.storage_download_history_file_count(
                  { count: entry.entries.length }
                )} · {formatFileSize(totalSize)} · {entry.archive
                  ? m.storage_download_history_zip()
                  : m.storage_download_history_direct()}
              </p>
            </div>
            <button
              class="btn btn-ghost btn-xs"
              aria-expanded={expanded[entry.id]}
              onclick={() => toggleDetails(entry.id)}
            >
              {expanded[entry.id]
                ? m.storage_download_history_hide_details()
                : m.storage_download_history_show_details()}
            </button>
          </div>
          {#if expanded[entry.id]}
            <fieldset class="border-base-300 mt-2 min-w-0 space-y-1 border-t pt-2">
              <legend class="text-base-content/70 text-[11px]" aria-live="polite">
                {m.storage_download_history_selected_count({ count: chosen.length })} · {formatFileSize(
                  selectedSize
                )}
              </legend>
              {#each entry.entries as item (`${entry.id}-${item.key}`)}
                <div class="flex items-center gap-2">
                  <input
                    id={`${uid}-${entry.id}-${item.key}`}
                    class="checkbox checkbox-xs"
                    type="checkbox"
                    checked={chosen.includes(item.key)}
                    onchange={(event) => toggleKey(entry.id, item.key, event.currentTarget.checked)}
                  />
                  <label
                    for={`${uid}-${entry.id}-${item.key}`}
                    class="text-base-content min-w-0 flex-1 truncate text-xs"
                    >{item.key}{item.isDirectory && !item.key.endsWith('/') ? '/' : ''}
                    <span class="text-base-content/50">({formatFileSize(item.size)})</span></label
                  >
                </div>
              {/each}
            </fieldset>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                class="btn btn-primary btn-xs"
                disabled={chosen.length === 0 || downloading === entry.id}
                onclick={() => download(entry.id, chosen)}
                >{m.storage_download_history_download_selected()}</button
              >
              <button
                class="btn btn-ghost btn-xs"
                disabled={downloading === entry.id}
                onclick={() =>
                  download(
                    entry.id,
                    entry.entries.map((item) => item.key)
                  )}>{m.storage_download_history_download_all()}</button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
