<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import { keyToName, parentPrefix } from '$lib/storage/utils.js';
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';
  import PreviewModal from './PreviewModal.svelte';
  import UploadModal from './upload/UploadModal.svelte';
  import DetailsModal from './DetailsModal.svelte';
  import RenameModal from './RenameModal.svelte';
  import CreateModal from './CreateModal.svelte';
  import MoveConfirmModal from './MoveConfirmModal.svelte';
  import ConflictResolutionDialog from './shared/ConflictResolutionDialog.svelte';

  const storage = getStorageState();

  let previewOpen = $state(true);
  let uploadOpen = $state(true);
  let deleteOpen = $state(true);
  let detailsOpen = $state(true);
  let renameOpen = $state(true);
  let moveConfirmOpen = $state(true);
  let createOpen = $state(true);
  let resolveConflictsOpen = $state(true);

  $effect(() => {
    if (storage.activeModal) {
      previewOpen = true;
      uploadOpen = true;
      deleteOpen = true;
      detailsOpen = true;
      renameOpen = true;
      moveConfirmOpen = true;
      createOpen = true;
      resolveConflictsOpen = true;
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

  $effect(() => {
    if (!renameOpen && storage.activeModal?.type === 'rename' && !storage.renameLoading) {
      storage.closeModal();
    }
  });

  $effect(() => {
    if (!moveConfirmOpen && storage.activeModal?.type === 'confirm-move') {
      storage.closeModal();
    }
  });

  $effect(() => {
    if (!resolveConflictsOpen && storage.activeModal?.type === 'resolve-conflicts') {
      storage.closeModal();
    }
  });

  $effect(() => {
    if (!createOpen && storage.activeModal?.type === 'create') {
      storage.closeModal();
    }
  });

  // Clear inline errors when the rename modal is dismissed via closeModal
  $effect(() => {
    if (!renameOpen) {
      storage.renameError = null;
      storage.renameLoading = false;
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
    bucket={storage.activeModal.payload.bucket ?? storage.bucket}
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
    initialFiles={storage.activeModal.payload.files}
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

{#if storage.activeModal?.type === 'rename'}
  {@const modalPayload = storage.activeModal.payload}
  {@const renameFolder = modalPayload.key.endsWith('/')}
  {@const renameName = keyToName(modalPayload.key)}
  <RenameModal
    bind:open={renameOpen}
    currentName={renameName}
    prefix={parentPrefix(modalPayload.key)}
    folder={renameFolder}
    onConfirm={(newName: string) => storage.confirmRename(modalPayload.key, newName)}
    onCancel={() => {
      storage.renameError = null;
      storage.renameLoading = false;
      storage.closeModal();
    }}
    loading={storage.renameLoading}
    error={storage.renameError}
  />
{/if}

{#if storage.activeModal?.type === 'confirm-move'}
  {@const modalPayload = storage.activeModal.payload}
  <MoveConfirmModal
    bind:open={moveConfirmOpen}
    keys={modalPayload.keys}
    destPrefix={modalPayload.destPrefix}
    items={modalPayload.items}
    onConfirm={storage.confirmMove}
    onCancel={storage.cancelMove}
  />
{/if}

{#if storage.activeModal?.type === 'create'}
  {@const modalPayload = storage.activeModal.payload}
  <CreateModal
    bind:open={createOpen}
    type={modalPayload.type}
    prefix={storage.prefix}
    onConfirm={(name: string) => storage.confirmCreate(name, modalPayload.type)}
    onCancel={storage.cancelCreate}
  />
{/if}

{#if storage.activeModal?.type === 'resolve-conflicts'}
  {@const modalPayload = storage.activeModal.payload}
  <ConflictResolutionDialog
    bind:open={resolveConflictsOpen}
    entries={modalPayload.entries}
    confirmLabel={modalPayload.confirmLabel}
    refused={modalPayload.refused}
    closeOnly={modalPayload.closeOnly}
    title={modalPayload.entries.length === 0 ? m.storage_transfer_refused_title() : undefined}
    description={modalPayload.entries.length === 0 ? '' : undefined}
    onConfirm={(entries) => storage.confirmConflictResolution(entries)}
    onCancel={() => storage.cancelConflictResolution()}
  />
{/if}
