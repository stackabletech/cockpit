<script lang="ts">
  import type { HTMLDialogAttributes } from 'svelte/elements';

  let {
    open = $bindable(false),
    children,
    class: className = '',
    dismissible = true,
    ...rest
  }: Omit<
    HTMLDialogAttributes,
    'open' | 'class' | 'children' | 'onclose' | 'oncancel' | 'onclick'
  > & {
    open: boolean;
    children: import('svelte').Snippet;
    class?: string;
    /** When false, Escape and backdrop clicks do not close the modal. */
    dismissible?: boolean;
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
    // Browsers may close a dialog despite a cancelled `cancel` event (e.g. a
    // repeated Escape press), so reopen it if it must stay open.
    if (!dismissible && open) {
      dialogEl?.showModal();
      return;
    }
    open = false;
  }

  function handleCancel(e: Event) {
    if (!dismissible) e.preventDefault();
  }

  function handleBackdropClick(e: MouseEvent) {
    // The click target is the <dialog> element itself only when the backdrop is
    // clicked; clicks inside the content bubble up to child elements instead.
    if (dismissible && e.target === dialogEl) {
      open = false;
    }
  }
</script>

<dialog
  {...rest}
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
