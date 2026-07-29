<script lang="ts">
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconFilePresent from 'virtual:icons/material-symbols/file-present';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    contentType: string;
    onDownload: () => void;
    /** When true, the content was determined to be binary (non-displayable UTF-8). */
    isBinary?: boolean;
  }

  let { contentType, onDownload, isBinary = false }: Props = $props();
</script>

<div class="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
  <IconFilePresent class="text-base-content/30 size-16" aria-hidden="true" />
  <div>
    <p class="text-base-content font-semibold">
      {isBinary ? m.storage_preview_binary_title() : m.storage_preview_unsupported_title()}
    </p>
    <p class="text-base-content/60 mt-1 text-sm">
      {isBinary ? m.storage_preview_binary_desc() : m.storage_preview_unsupported_desc()}
    </p>
    {#if contentType}
      <p class="text-base-content/40 mt-1 font-mono text-xs">{contentType}</p>
    {/if}
  </div>
  <button type="button" onclick={onDownload} class="btn btn-primary btn-sm gap-2">
    <IconDownload class="size-4" aria-hidden="true" />
    {m.storage_preview_download_full()}
  </button>
</div>
