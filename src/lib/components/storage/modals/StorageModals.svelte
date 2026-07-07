<script lang="ts">
  import { getStorageState } from '$lib/storage/context.js';
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';
  import PreviewModal from './PreviewModal.svelte';
  import UploadModal from './upload/UploadModal.svelte';
  import DetailsModal from './DetailsModal.svelte';

  const storage = getStorageState();

  let previewOpen = $state(true);
  let uploadOpen = $state(true);
  let deleteOpen = $state(true);
  let detailsOpen = $state(true);

  $effect(() => {
    if (storage.activeModal) {
      previewOpen = true;
      uploadOpen = true;
      deleteOpen = true;
      detailsOpen = true;
    }
  });

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

  $effect(() => {
    if (!detailsOpen && storage.activeModal?.type === 'details') {
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
    archiveKey={storage.activeModal.payload.archiveKey}
    archivePath={storage.activeModal.payload.archivePath}
    nestedArchivePath={storage.activeModal.payload.nestedArchivePath}
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

{#if storage.activeModal?.type === 'details'}
  <DetailsModal
    bind:open={detailsOpen}
    type={storage.activeModal.payload.type}
    bucket={storage.activeModal.payload.bucket}
    key={storage.activeModal.payload.key}
    prefix={storage.activeModal.payload.prefix}
  />
{/if}
