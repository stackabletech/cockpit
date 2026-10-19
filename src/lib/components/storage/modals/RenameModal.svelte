<script lang="ts">
  import IconDriveFileRenameOutline from 'virtual:icons/material-symbols/drive-file-rename-outline';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { objectNameError } from '$lib/storage/name-validation.js';

  interface Props {
    open?: boolean;
    currentName: string;
    /** The folder the item is in; empty for the bucket root. */
    prefix?: string;
    /** Whether the item is a folder, so its key ends with `/`. */
    folder?: boolean;
    onConfirm: (newName: string) => void;
    onCancel: () => void;
    loading?: boolean;
    error?: string | null;
  }

  let {
    open = $bindable(false),
    currentName,
    prefix = '',
    folder = false,
    onConfirm,
    onCancel,
    loading = false,
    error = null
  }: Props = $props();

  const uid = $props.id();
  let newName = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  // Compare untrimmed too: names from other tools may start or end with whitespace.
  const unchanged = $derived(newName === currentName || newName.trim() === currentName);
  // An existing name may hold characters S3 allows but new names may not; only judge edits.
  const nameError = $derived(
    unchanged ? null : objectNameError(newName, { prefix, folder, singleSegment: true })
  );

  function handleConfirm() {
    if (loading || nameError) return;
    if (unchanged) {
      onCancel();
      return;
    }
    onConfirm(newName.trim());
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !loading) handleConfirm();
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
      class="input input-sm w-full"
      class:input-error={!!nameError}
      bind:value={newName}
      onkeydown={handleKeydown}
      disabled={loading}
      aria-invalid={nameError ? 'true' : undefined}
      aria-describedby={nameError ? uid + '-rename-name-error' : undefined}
    />
    <p
      id={uid + '-rename-name-error'}
      class="text-error text-sm"
      class:mt-2={!!nameError}
      aria-live="polite"
    >
      {nameError ?? ''}
    </p>

    {#if error}
      <p class="text-error mt-2 text-sm">{error}</p>
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost btn-sm" disabled={loading} onclick={onCancel}>
        {m.storage_action_rename_inline_cancel()}
      </button>
      <button
        class="btn btn-primary btn-sm"
        disabled={!!nameError || unchanged || loading}
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
