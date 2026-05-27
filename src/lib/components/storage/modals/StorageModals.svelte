<script lang="ts">
  import { getStorageState } from '$lib/storage/context.js';
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';
  import PreviewModal from './PreviewModal.svelte';
  import UploadModal from './upload/UploadModal.svelte';

  const storage = getStorageState();

  // Local open state for modals that can close themselves (click-outside, etc.)
  // These start as true when mounted and sync back to storage state when closed.
  let previewOpen = $state(true);
  let uploadOpen = $state(true);
  let deleteOpen = $state(true);

  // Reset local state when modal type changes
  $effect(() => {
    if (storage.activeModal) {
      previewOpen = true;
      uploadOpen = true;
      deleteOpen = true;
    }
  });

  // Sync modal close-via-UI back to state
  $effect(() => {
    if (!previewOpen && storage.activeModal?.type === 'preview') {
      storage.closeModal();
    }
  });

  $effect(() => {
    if (!uploadOpen && storage.activeModal?.type === 'upload') {
      storage.closeModal();
    }
  });

  $effect(() => {
    if (!deleteOpen && storage.activeModal?.type === 'delete') {
      storage.closeModal();
    }
  });
</script>

{#if storage.activeModal?.type === 'delete'}
  <DeleteConfirmModal
    bind:open={deleteOpen}
    keys={storage.activeModal.payload.keys}
    onConfirm={storage.confirmDelete}
    onCancel={storage.cancelDelete}
  />
{/if}

{#if storage.activeModal?.type === 'preview'}
  <PreviewModal
    bind:open={previewOpen}
    bucket={storage.bucket}
    objectKey={storage.activeModal.payload.key}
  />
{/if}

{#if storage.activeModal?.type === 'upload'}
  <UploadModal
    bind:open={uploadOpen}
    bucket={storage.activeModal.payload.bucket}
    prefix={storage.activeModal.payload.prefix}
    onSuccess={storage.handleUploadSuccess}
  />
{/if}
