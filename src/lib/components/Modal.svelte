<script lang="ts">
  let {
    open = $bindable(false),
    children,
    class: className = ''
  }: {
    open: boolean;
    children: import('svelte').Snippet;
    class?: string;
  } = $props();

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

<dialog bind:this={dialogEl} class={className} onclose={handleClose} onclick={handleBackdropClick}>
  {#if open}
    {@render children()}
  {/if}
</dialog>
