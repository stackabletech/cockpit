<script lang="ts">
  import { keyToName } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import { FILE_ICON_CONFIG, fileIconKind } from './iconConfig.js';
  import type { IconConfig } from './iconConfig.js';

  interface Props {
    file: StorageObject;
  }

  const { file }: Props = $props();

  const kind = $derived(fileIconKind(file.contentType, file.key));
  const config = $derived(FILE_ICON_CONFIG[kind]);

  const ext = $derived(file.key.split('.').at(-1)?.toLowerCase() ?? '');
  const badge = $derived(file.contentType ? (file.contentType.split('/').at(-1) ?? '') : ext);
</script>

<div class="flex items-center gap-2.5">
  {@render renderIcon(config)}
  <span class="truncate">{keyToName(file.key)}</span>
  {#if badge}
    <span class="badge badge-ghost badge-sm ml-1 shrink-0 text-[10px] opacity-50">
      {badge}
    </span>
  {/if}
</div>

{#snippet renderIcon(cfg: IconConfig)}
  <cfg.component class="pointer-events-none size-5 shrink-0" aria-hidden="true" />
{/snippet}
