<script lang="ts">
  let {
    open = $bindable(false),
    children,
    class: className = '',
    closeguard
  }: {
    open: boolean;
    children: import('svelte').Snippet;
    class?: string;
    closeguard?: () => boolean;
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

  function handleCancel(e: Event) {
    if (closeguard && !closeguard()) {
      e.preventDefault();
    }
  }

  // Firefox does not reliably close <dialog> on Escape via the cancel event,
  // so we handle Escape at the window level as a fallback.
  $effect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (!dialogEl?.open) return;
      e.preventDefault();
      if (closeguard && !closeguard()) return;
      open = false;
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function handleBackdropClick(e: MouseEvent) {
    // The click target is the <dialog> element itself only when the backdrop is
    // clicked; clicks inside the content bubble up to child elements instead.
    if (e.target !== dialogEl) return;
    if (closeguard && !closeguard()) {
      e.preventDefault();
    } else {
      open = false;
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  class={className}
  onclose={handleClose}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  {#if open}
    {@render children()}
  {/if}
</dialog>
