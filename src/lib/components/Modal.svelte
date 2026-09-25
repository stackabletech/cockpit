<script lang="ts">
  let {
    open = $bindable(false),
    children,
    variant = 'default',
    class: className = ''
  }: {
    open: boolean;
    children: import('svelte').Snippet;
    /**
     * - `default` — DaisyUI's centred `modal`, paired with a `modal-box` child.
     * - `fullscreen` — edge-to-edge sheet; the child owns the whole viewport.
     */
    variant?: 'default' | 'fullscreen';
    /** Extra classes, appended to the variant's own. */
    class?: string;
  } = $props();

  const variantClass = {
    default: 'modal',
    fullscreen: 'bg-base-100 fixed inset-0 z-40 size-full max-h-full max-w-full p-0'
  } as const;

  const dialogClass = $derived(`${variantClass[variant]} ${className}`.trim());

  let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

  // Sync the `open` prop with the native <dialog> open/close state.
  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      dialogEl.showModal();
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  function handleClose() {
    open = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    // The click target is the <dialog> element itself only when the backdrop is
    // clicked; clicks inside the content bubble up to child elements instead.
    if (e.target === dialogEl) {
      open = false;
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  class={dialogClass}
  onclose={handleClose}
  onclick={handleBackdropClick}
>
  {#if open}
    {@render children()}
  {/if}
</dialog>
