<script lang="ts" module>
  // Dialogs in the order they were opened. The browser's top layer follows
  // this order, while document order (e.g. `querySelectorAll`) does not: a
  // modal opened on top of another can come earlier in the DOM.
  const openOrder: HTMLDialogElement[] = [];

  function forget(dialog: HTMLDialogElement): void {
    const index = openOrder.indexOf(dialog);
    if (index !== -1) openOrder.splice(index, 1);
  }

  function topmostDialog(): HTMLDialogElement | undefined {
    return openOrder.filter((dialog) => dialog.open && dialog.isConnected).at(-1);
  }
</script>

<script lang="ts">
  let {
    open = $bindable(false),
    children,
    variant = 'default',
    class: className = '',
    dismissible = true,
    closeguard,
    ...restProps
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
    /** When false, Escape and backdrop clicks do not close the modal. */
    dismissible?: boolean;
    closeguard?: () => boolean;
  } & Omit<
    import('svelte/elements').HTMLDialogAttributes,
    'children' | 'open' | 'class'
  > = $props();

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
      forget(dialogEl);
      openOrder.push(dialogEl);
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  function handleClose(e: Event) {
    // The `close` event fires in a later task than `dialog.close()`. If this
    // component was destroyed in the meantime, the shared `open` binding may
    // already belong to a newly opened dialog, which must not be closed.
    if (e.currentTarget !== dialogEl) return;
    // Browsers may close a dialog despite a cancelled `cancel` event (e.g. a
    // repeated Escape press), so reopen it if it must stay open.
    if (!dismissible && open) {
      dialogEl?.showModal();
      return;
    }
    open = false;
  }

  function handleCancel(e: Event) {
    if (!dismissible || (closeguard && !closeguard())) {
      e.preventDefault();
    }
  }

  $effect(() => {
    const dialog = dialogEl;
    return () => {
      if (dialog) forget(dialog);
    };
  });

  // Firefox does not reliably close <dialog> on Escape via the cancel event
  // (Monaco's text-area input, used there, always prevents the default of
  // Escape), so we handle Escape at the window level as a fallback. This runs
  // in the bubbling phase so that inner layers (a popover, Monaco's find or
  // suggest widget, a nested modal) get Escape first: an inner handler that
  // stops propagation and prevents the default keeps the dialog open.
  $effect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Monaco's text-area input (Firefox) prevents the default of every
      // Escape, also when no widget uses it; a widget that does also stops
      // propagation. Chromium's EditContext path does neither.
      if (
        e.defaultPrevented &&
        !(e.target instanceof Element && e.target.closest('.monaco-editor'))
      )
        return;
      if (!dialogEl?.open) return;
      if (topmostDialog() !== dialogEl) return;
      // An open auto popover inside the dialog (e.g. a date picker) is closed
      // by the browser on Escape; the dialog itself must stay open.
      if (dialogEl.querySelector('[popover]:not([popover="manual"]):popover-open')) return;
      e.preventDefault();
      if (!dismissible) return;
      if (closeguard && !closeguard()) return;
      open = false;
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function handleBackdropClick(e: MouseEvent) {
    // The click target is the <dialog> element itself only when the backdrop is
    // clicked; clicks inside the content bubble up to child elements instead.
    if (e.target !== dialogEl || !dismissible) return;
    if (closeguard && !closeguard()) {
      e.preventDefault();
    } else {
      open = false;
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  class={dialogClass}
  {...restProps}
  onclose={handleClose}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  {#if open}
    {@render children()}
  {/if}
</dialog>
