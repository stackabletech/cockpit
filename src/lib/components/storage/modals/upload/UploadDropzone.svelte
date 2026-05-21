<script lang="ts">
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { collectDroppedFiles } from '$lib/storage/file-collection.js';

  interface Props {
    onFilesSelected: (pairs: { file: File; relativePath: string }[]) => void;
  }

  let { onFilesSelected }: Props = $props();
  const uid = $props.id();

  let dragOver = $state(false);
  let fileInputEl: HTMLInputElement | null = $state(null);
  let dirInputEl: HTMLInputElement | null = $state(null);

  $effect(() => {
    dirInputEl?.setAttribute('webkitdirectory', '');
  });

  function handleInputChange(e: Event) {
    const list = (e.target as HTMLInputElement).files;
    if (!list || list.length === 0) return;
    const pairs = Array.from(list).map((f) => ({
      file: f,
      relativePath: f.webkitRelativePath || f.name
    }));
    onFilesSelected(pairs);
    (e.target as HTMLInputElement).value = '';
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const dt = e.dataTransfer;
    if (!dt) return;

    let pairs: { file: File; relativePath: string }[];
    try {
      pairs = await collectDroppedFiles(dt);
    } catch {
      pairs = Array.from(dt.files).map((f) => ({ file: f, relativePath: f.name }));
    }

    if (pairs.length === 0) return;
    onFilesSelected(pairs);
  }
</script>

<input
  bind:this={fileInputEl}
  id="{uid}-files"
  type="file"
  class="sr-only"
  multiple
  onchange={handleInputChange}
  aria-label={m.storage_upload_select_files()}
/>
<input
  bind:this={dirInputEl}
  id="{uid}-dir"
  type="file"
  class="sr-only"
  onchange={handleInputChange}
  aria-label={m.storage_upload_select_folder()}
/>

<div
  role="button"
  tabindex="0"
  class="border-base-300 hover:border-primary/60 hover:bg-primary/5 mb-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 transition-colors {dragOver
    ? 'border-primary bg-primary/5'
    : ''}"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => {
    dragOver = false;
  }}
  ondrop={handleDrop}
  onclick={() => fileInputEl?.click()}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputEl?.click();
    }
  }}
  aria-label={m.storage_upload_drop_prompt()}
>
  <Icon
    icon="material-symbols:upload-file"
    class="text-base-content/30 size-12"
    aria-hidden="true"
  />
  <p class="text-base-content/60 text-center text-sm">{m.storage_upload_drop_prompt()}</p>
</div>

<div class="flex justify-center gap-3">
  <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={() => fileInputEl?.click()}>
    <Icon icon="material-symbols:file-copy-outline" class="size-4" aria-hidden="true" />
    {m.storage_upload_select_files()}
  </button>
  <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={() => dirInputEl?.click()}>
    <Icon icon="material-symbols:folder-open" class="size-4" aria-hidden="true" />
    {m.storage_upload_select_folder()}
  </button>
</div>
