<script lang="ts">
  import IconDescriptionOutline from 'virtual:icons/material-symbols/description-outline';
  import IconFolderOutline from 'virtual:icons/material-symbols/folder-outline';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';

  interface Props {
    open?: boolean;
    type: 'file' | 'folder';
    onConfirm: (name: string) => void;
    onCancel: () => void;
    loading?: boolean;
    error?: string | null;
  }

  let {
    open = $bindable(false),
    type,
    onConfirm,
    onCancel,
    loading = false,
    error = null
  }: Props = $props();

  const uid = $props.id();
  let name = $state(type === 'file' ? 'untitled.txt' : 'new-folder');
  let inputEl = $state<HTMLInputElement | null>(null);

  const NAME_INVALID_CHARS = /[^\w\s./()\-+@,:;!$*'=]/g;

  function sanitize(raw: string): string {
    return raw.replace(NAME_INVALID_CHARS, '');
  }

  function handleConfirm() {
    const sanitized = sanitize(name.trim());
    if (sanitized && sanitized !== '.' && sanitized !== '..') {
      onConfirm(sanitized);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onCancel();
  }

  $effect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputEl?.focus();
        if (inputEl) {
          if (type === 'file') {
            const dotIdx = name.lastIndexOf('.');
            const selEnd = dotIdx > 0 ? dotIdx : name.length;
            inputEl.setSelectionRange(0, selEnd);
          } else {
            inputEl.select();
          }
        }
      });
    }
  });
</script>

<Modal bind:open class="modal">
  <div class="modal-box max-w-sm">
    <h3 class="mb-1 flex items-center gap-2 text-lg font-bold">
      {#if type === 'file'}
        <IconDescriptionOutline class="size-5 shrink-0" aria-hidden="true" />
        {m.storage_create_file()}
      {:else}
        <IconFolderOutline class="size-5 shrink-0" aria-hidden="true" />
        {m.storage_create_folder()}
      {/if}
    </h3>

    <label for={uid + '-create-input'} class="label label-text mt-3 mb-1 p-0">
      {m.storage_create_name()}
    </label>
    <input
      bind:this={inputEl}
      id={uid + '-create-input'}
      class="input input-sm w-full"
      placeholder={m.storage_create_placeholder()}
      value={name}
      oninput={(e) => {
        name = sanitize(e.currentTarget.value);
      }}
      onkeydown={handleKeydown}
      disabled={loading}
    />

    {#if error}
      <p class="text-error mt-2 text-sm">{error}</p>
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost btn-sm" disabled={loading} onclick={onCancel}>
        {m.storage_create_cancel()}
      </button>
      <button
        class="btn btn-primary btn-sm"
        disabled={!name.trim() || loading}
        onclick={handleConfirm}
      >
        {#if loading}
          <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        {/if}
        {m.storage_create_confirm()}
      </button>
    </div>
  </div>
</Modal>
