<script lang="ts">
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    contentType: string;
    downloadUrl: string;
    name: string;
    /** When true, the content was determined to be binary (non-displayable UTF-8). */
    isBinary?: boolean;
  }

  let { contentType, downloadUrl, name, isBinary = false }: Props = $props();
</script>

<div class="flex flex-col items-center gap-4 p-8 text-center">
  <Icon
    icon="material-symbols:file-present"
    class="text-base-content/30 size-16"
    aria-hidden="true"
  />
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
  <a href={downloadUrl} download={name} class="btn btn-primary btn-sm gap-2">
    <Icon icon="material-symbols:download" class="size-4" aria-hidden="true" />
    {m.storage_preview_download_full()}
  </a>
</div>
