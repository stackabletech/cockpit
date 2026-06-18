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

  function handleBackdrop(e: MouseEvent) {
    if (e.target === dialogEl && closeguard && !closeguard()) {
      e.preventDefault();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  class={className}
  onclose={handleClose}
  oncancel={handleCancel}
  onmousedown={handleBackdrop}
>
  {#if open}
    {@render children()}
  {/if}
</dialog>
