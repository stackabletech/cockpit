<script lang="ts">
  let {
    open = $bindable(false),
    children,
    class: className = '',
    closeguard,
    ...restProps
  }: {
    open: boolean;
    children: import('svelte').Snippet;
    class?: string;
    closeguard?: () => boolean;
  } & Omit<
    import('svelte/elements').HTMLDialogAttributes,
    'children' | 'open' | 'class'
  > = $props();

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
  // so we handle Escape at the window level as a fallback. Use capture so
  // focused widgets such as Monaco cannot stop it reaching this handler.
  $effect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      if (!dialogEl?.open) return;
      const dialogs = [...document.querySelectorAll('dialog[open]')];
      if (dialogs.at(-1) !== dialogEl) return;
      e.preventDefault();
      if (closeguard && !closeguard()) return;
      open = false;
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
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
  {...restProps}
  onclose={handleClose}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  {#if open}
    {@render children()}
  {/if}
</dialog>
