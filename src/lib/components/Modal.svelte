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
</script>

<dialog bind:this={dialogEl} class={className} onclose={handleClose}>
  {#if open}
    {@render children()}
  {/if}
</dialog>
