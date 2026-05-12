<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    /** Object URL for the image blob. */
    src: string;
    name: string;
  }

  let { src, name }: Props = $props();

  let naturalWidth = $state(0);
  let naturalHeight = $state(0);
</script>

<div class="flex flex-col items-center gap-3 p-4">
  <img
    {src}
    alt={m.storage_preview_image_alt({ name })}
    class="max-h-[60vh] max-w-full rounded object-contain shadow"
    onload={(e) => {
      const img = e.currentTarget as HTMLImageElement;
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;
    }}
  />
  {#if naturalWidth > 0}
    <p class="text-base-content/50 text-xs">
      {naturalWidth} &times; {naturalHeight}
    </p>
  {/if}
</div>
