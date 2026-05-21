<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    /** Object URL for the image blob. */
    src: string;
    name: string;
    naturalWidth?: number;
    naturalHeight?: number;
  }

  let { src, name, naturalWidth = $bindable(0), naturalHeight = $bindable(0) }: Props = $props();
</script>

<div class="flex h-full items-center justify-center p-4">
  <img
    {src}
    alt={m.storage_preview_image_alt({ name })}
    class="max-h-full max-w-full rounded object-contain shadow"
    onload={(e) => {
      const img = e.currentTarget as HTMLImageElement;
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;
    }}
  />
</div>
