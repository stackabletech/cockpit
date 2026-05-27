<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import IconDeleteForever from 'virtual:icons/material-symbols/delete-forever';
  import IconWarningRounded from 'virtual:icons/material-symbols/warning-rounded';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    open: boolean;
    keys: string[];
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { open = $bindable(), keys, onConfirm, onCancel }: Props = $props();

  const count = $derived(keys.length);
  const firstName = $derived(keys[0]?.split('/').filter(Boolean).pop() ?? '');
  const hasDirectories = $derived(keys.some((k) => k.endsWith('/')));
</script>

<Modal bind:open class="modal">
  <div class="modal-box {hasDirectories ? 'max-w-md' : 'max-w-sm'}">
    <h3 class="text-error mb-3 flex items-center gap-2 text-lg font-bold">
      <IconDeleteForever class="size-5 shrink-0" aria-hidden="true" />
      {count === 1
        ? m.storage_delete_confirm_title_one({ name: firstName })
        : m.storage_delete_confirm_title_many({ count })}
    </h3>

    {#if hasDirectories}
      <div class="border-error/40 bg-error/10 mb-4 rounded-lg border p-4" role="alert">
        <p class="text-error mb-1 flex items-center gap-2 font-semibold">
          <IconWarningRounded class="size-5 shrink-0" aria-hidden="true" />
          {m.storage_delete_dir_warning_heading()}
        </p>
        <p class="text-base-content/80 text-sm">
          {m.storage_delete_dir_warning_body()}
        </p>
      </div>
    {:else}
      <p class="text-base-content/80 text-sm">
        {m.storage_delete_confirm_message()}
      </p>
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost" onclick={onCancel}>
        {m.storage_delete_cancel()}
      </button>
      <button class="btn btn-outline btn-error" onclick={onConfirm}>
        <IconDeleteForever class="size-4" aria-hidden="true" />
        {m.storage_delete_confirm_button()}
      </button>
    </div>
  </div>
</Modal>
