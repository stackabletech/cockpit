<script lang="ts">
  import IconDriveFileRenameOutline from 'virtual:icons/material-symbols/drive-file-rename-outline';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';

  interface Props {
    open?: boolean;
    currentName: string;
    onConfirm: (newName: string) => void;
    onCancel: () => void;
    loading?: boolean;
    error?: string | null;
  }

  let {
    open = $bindable(false),
    currentName,
    onConfirm,
    onCancel,
    loading = false,
    error = null
  }: Props = $props();

  const uid = $props.id();
  let newName = $state(currentName);
  let inputEl = $state<HTMLInputElement | null>(null);

  function handleConfirm() {
    if (newName.trim() && newName.trim() !== currentName) {
      onConfirm(newName.trim());
    } else {
      onCancel();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onCancel();
  }

  $effect(() => {
    if (open) {
      newName = currentName;
      // Focus and select the name (without extension) on open
      requestAnimationFrame(() => {
        inputEl?.focus();
        if (inputEl) {
          const dotIdx = currentName.lastIndexOf('.');
          const selEnd = dotIdx > 0 ? dotIdx : currentName.length;
          inputEl.setSelectionRange(0, selEnd);
        }
      });
    }
  });
</script>

<Modal bind:open class="modal" closeguard={() => !loading}>
  <div class="modal-box max-w-sm">
    <h3 class="mb-1 flex items-center gap-2 text-lg font-bold">
      <IconDriveFileRenameOutline class="size-5 shrink-0" aria-hidden="true" />
      {m.storage_action_rename()}
    </h3>

    <label for={uid + '-rename-input'} class="label label-text mt-3 mb-1 p-0">
      {m.storage_action_rename_inline_label()}
    </label>
    <input
      bind:this={inputEl}
      id={uid + '-rename-input'}
      class="input input-bordered input-sm w-full"
      bind:value={newName}
      onkeydown={handleKeydown}
      disabled={loading}
    />

    {#if error}
      <p class="text-error mt-2 text-sm">{error}</p>
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost btn-sm" disabled={loading} onclick={onCancel}>
        {m.storage_action_rename_inline_cancel()}
      </button>
      <button
        class="btn btn-primary btn-sm"
        disabled={!newName.trim() || newName.trim() === currentName || loading}
        onclick={handleConfirm}
      >
        {#if loading}
          <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        {/if}
        {m.storage_action_rename()}
      </button>
    </div>
  </div>
</Modal>
