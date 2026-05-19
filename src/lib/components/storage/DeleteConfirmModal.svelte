<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import Icon from '@iconify/svelte';
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
</script>

<Modal bind:open class="modal">
  <div class="modal-box max-w-sm">
    <h3 class="text-error mb-3 flex items-center gap-2 text-lg font-bold">
      <Icon icon="material-symbols:delete-forever" class="size-5 shrink-0" aria-hidden="true" />
      {count === 1
        ? m.storage_delete_confirm_title_one({ name: firstName })
        : m.storage_delete_confirm_title_many({ count })}
    </h3>
    <p class="text-base-content/80 text-sm">
      {m.storage_delete_confirm_message()}
    </p>
    <div class="modal-action mt-6">
      <button class="btn btn-ghost" onclick={onCancel}>
        {m.storage_delete_cancel()}
      </button>
      <button class="btn btn-error" onclick={onConfirm}>
        <Icon icon="material-symbols:delete-forever" class="size-4" aria-hidden="true" />
        {m.storage_delete_confirm_button()}
      </button>
    </div>
  </div>
</Modal>
