<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    /** Object URL for the PDF blob. */
    src: string;
    name: string;
  }

  let { src, name }: Props = $props();
</script>

<iframe
  {src}
  title={m.storage_preview_image_alt({ name })}
  class="h-full w-full rounded border-0"
  aria-label={m.storage_preview_image_alt({ name })}
></iframe>
