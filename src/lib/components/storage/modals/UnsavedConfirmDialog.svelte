<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import IconWarningRounded from 'virtual:icons/material-symbols/warning-rounded';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    open: boolean;
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
  }

  let { open = $bindable(false), onSave, onDiscard, onCancel }: Props = $props();
</script>

<Modal bind:open class="modal">
  <div class="modal-box max-w-sm">
    <h3 class="mb-3 flex items-center gap-2 text-lg font-bold">
      <IconWarningRounded class="text-warning size-5 shrink-0" aria-hidden="true" />
      {m.storage_editor_unsaved_title()}
    </h3>

    <p class="text-base-content/80 text-sm">
      {m.storage_editor_unsaved_desc()}
    </p>

    <div class="modal-action mt-6">
      <button class="btn btn-ghost btn-sm" onclick={onCancel}>
        {m.storage_editor_cancel()}
      </button>
      <button class="btn btn-outline btn-ghost btn-error btn-sm" onclick={onDiscard}>
        {m.storage_editor_discard()}
      </button>
      <button class="btn btn-primary btn-sm" onclick={onSave}>
        {m.storage_editor_save_and_close()}
      </button>
    </div>
  </div>
</Modal>
