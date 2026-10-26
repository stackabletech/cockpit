<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import IconDeleteForever from 'virtual:icons/material-symbols/delete-forever';
  import IconDelete from 'virtual:icons/material-symbols/delete-outline';
  import IconWarningRounded from 'virtual:icons/material-symbols/warning-rounded';
  import * as m from '$lib/paraglide/messages.js';
  import type { TrashInfo } from '$lib/storage/types.js';

  interface Props {
    open: boolean;
    keys: string[];
    /** Trash settings of the backend; `null` or disabled means deletes are permanent. */
    trash?: TrashInfo | null;
    onConfirm: (options: { trash: boolean }) => void;
    onCancel: () => void;
  }

  let { open = $bindable(), keys, trash = null, onConfirm, onCancel }: Props = $props();

  const uid = $props.id();
  let permanent = $state(false);
  const useTrash = $derived(!!trash?.enabled && !permanent);
  const trashMessage = $derived(
    trash && trash.intervalMinutes % 60 === 0
      ? m.storage_delete_trash_message_hours({ hours: trash.intervalMinutes / 60 })
      : m.storage_delete_trash_message_minutes({ minutes: trash?.intervalMinutes ?? 0 })
  );

  const count = $derived(keys.length);
  const firstName = $derived(keys[0]?.split('/').filter(Boolean).pop() ?? '');
  const hasDirectories = $derived(keys.some((k) => k.endsWith('/')));
</script>

<Modal bind:open class="modal">
  <div class="modal-box {hasDirectories ? 'max-w-md' : 'max-w-sm'}">
    <h3
      class="mb-3 flex items-center gap-2 text-lg font-bold {useTrash
        ? 'text-warning'
        : 'text-error'}"
    >
      {#if useTrash}
        <IconDelete class="size-5 shrink-0" aria-hidden="true" />
        {count === 1
          ? m.storage_delete_trash_title_one({ name: firstName })
          : m.storage_delete_trash_title_many({ count })}
      {:else}
        <IconDeleteForever class="size-5 shrink-0" aria-hidden="true" />
        {count === 1
          ? m.storage_delete_confirm_title_one({ name: firstName })
          : m.storage_delete_confirm_title_many({ count })}
      {/if}
    </h3>

    {#if useTrash}
      <p class="text-base-content/80 text-sm">{trashMessage}</p>
    {:else if hasDirectories}
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

    {#if trash?.enabled}
      <div class="mt-4 flex items-center gap-2">
        <input
          id="{uid}-permanent"
          type="checkbox"
          class="checkbox checkbox-error checkbox-sm"
          bind:checked={permanent}
        />
        <label for="{uid}-permanent" class="text-sm">{m.storage_delete_trash_permanent()}</label>
      </div>
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost" onclick={onCancel}>
        {m.storage_delete_cancel()}
      </button>
      {#if useTrash}
        <button class="btn btn-outline btn-warning" onclick={() => onConfirm({ trash: true })}>
          <IconDelete class="size-4" aria-hidden="true" />
          {m.storage_delete_trash_button()}
        </button>
      {:else}
        <button class="btn btn-outline btn-error" onclick={() => onConfirm({ trash: false })}>
          <IconDeleteForever class="size-4" aria-hidden="true" />
          {m.storage_delete_confirm_button()}
        </button>
      {/if}
    </div>
  </div>
</Modal>
