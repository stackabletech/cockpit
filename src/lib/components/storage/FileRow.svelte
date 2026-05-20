<script lang="ts">
  import Icon from '@iconify/svelte';
  import { fileIconKind, iconColors, keyToName } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import prettyBytes from 'pretty-bytes';
  import TimestampDisplay from '$lib/components/storage/TimestampDisplay.svelte';

  interface Props {
    file: StorageObject;
    selected: boolean;
    isCtx: boolean;
    showCheckboxes: boolean;
    onToggleSelect: (key: string, force?: boolean) => void;
    onContextMenu: (e: MouseEvent, key: string) => void;
    onAction: (action: string) => void;
  }

  let { file, selected, isCtx, showCheckboxes, onToggleSelect, onContextMenu, onAction }: Props =
    $props();

  const kind = $derived(fileIconKind(file.contentType));
  const color = $derived(iconColors[kind]);
</script>

<tr
  class="
    group cursor-pointer select-none
    {isCtx
    ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
    : selected
      ? 'bg-primary/10 hover:bg-primary/15'
      : 'hover:bg-base-200/60'}"
  onclick={(e) => onToggleSelect(file.key, e.ctrlKey || e.metaKey)}
  ondblclick={() => onAction('preview')}
  oncontextmenu={(e) => onContextMenu(e, file.key)}
>
  <td class="pr-0">
    <input
      type="checkbox"
      class="checkbox checkbox-xs {!showCheckboxes ? 'pointer-events-none invisible' : ''}"
      checked={selected}
      onchange={() => onToggleSelect(file.key, true)}
      onclick={(e) => e.stopPropagation()}
      disabled={!showCheckboxes}
      aria-label="Select {keyToName(file.key)}"
    />
  </td>
  <td>
    <div class="flex items-center gap-2.5">
      {#if kind === 'image'}
        <Icon icon="material-symbols:image" class="size-5 shrink-0 {color}" aria-hidden="true" />
      {:else if kind === 'code'}
        <Icon icon="material-symbols:code" class="size-5 shrink-0 {color}" aria-hidden="true" />
      {:else if kind === 'archive'}
        <Icon icon="material-symbols:archive" class="size-5 shrink-0 {color}" aria-hidden="true" />
      {:else if kind === 'pdf'}
        <Icon
          icon="material-symbols:picture-as-pdf"
          class="size-5 shrink-0 {color}"
          aria-hidden="true"
        />
      {:else}
        <Icon
          icon="material-symbols:description"
          class="size-5 shrink-0 {color}"
          aria-hidden="true"
        />
      {/if}
      <span class="truncate">{keyToName(file.key)}</span>
      {#if file.contentType}
        <span class="badge badge-ghost badge-sm ml-1 shrink-0 text-[10px] opacity-50">
          {file.contentType.split('/').at(-1) ?? ''}
        </span>
      {/if}
    </div>
  </td>
  <td class="text-right font-mono text-sm">{prettyBytes(file.size)}</td>
  <td class="text-base-content/60 text-sm"
    ><TimestampDisplay date={file.lastModified} relative /></td
  >
  <td class="w-10 py-0 pr-2 text-right">
    <button
      class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100"
      title="Actions"
      aria-label="Actions for {keyToName(file.key)}"
      onclick={(e) => onContextMenu(e, file.key)}
    >
      <Icon icon="material-symbols:more-horiz" class="size-4" aria-hidden="true" />
    </button>
  </td>
</tr>
