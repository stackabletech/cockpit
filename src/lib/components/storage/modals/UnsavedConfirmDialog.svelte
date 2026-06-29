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
      <!-- eslint-disable-next-line better-tailwindcss/no-unknown-classes -->
      <button class="btn btn-primary save-btn" onclick={onSave}>
        {m.storage_editor_save_and_close()}
      </button>
    </div>
  </div>
</Modal>

<style>
  /*
   * The save button needs to wrap its label text in German ("Speichern und schließen").
   * DaisyUI places all .btn styles inside @layer daisyui.*, so Svelte's unlayered
   * component styles unconditionally win the cascade without !important.
   *
   * - flex/min-width: button fills remaining row space (cancel+discard are btn-sm,
   *   leaving ~154 px here — enough for two-line German text).
   * - height/align-self: removes the fixed --size height and opts out of the
   *   parent's align-items:stretch so the button can actually grow taller.
   * - white-space/line-height: allow the label to break at word boundaries.
   */
  .save-btn {
    flex: 1;
    min-width: 0;
    white-space: normal;
    height: auto;
    min-height: 2.5rem;
    align-self: center;
    line-height: 1.25;
  }
</style>
