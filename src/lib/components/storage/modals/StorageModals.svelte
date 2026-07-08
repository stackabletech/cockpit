<script lang="ts">
  import { getStorageState } from '$lib/storage/context.js';
  import { keyToName } from '$lib/storage/utils.js';
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';
  import PreviewModal from './PreviewModal.svelte';
  import UploadModal from './upload/UploadModal.svelte';
  import RenameModal from './RenameModal.svelte';
  import MoveConfirmModal from './MoveConfirmModal.svelte';
  import ConflictResolutionDialog from './shared/ConflictResolutionDialog.svelte';
  import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
  import { checkObjectExists } from '$lib/storage/upload.js';

  const storage = getStorageState();

  // Local open state for modals that can close themselves (click-outside, etc.)
  // These start as true when mounted and sync back to storage state when closed.
  let previewOpen = $state(true);
  let uploadOpen = $state(true);
  let deleteOpen = $state(true);
  let renameOpen = $state(true);
  let moveConfirmOpen = $state(true);
  let resolveConflictsOpen = $state(true);

  // Reset local state when modal type changes
  $effect(() => {
    if (storage.activeModal) {
      previewOpen = true;
      uploadOpen = true;
      deleteOpen = true;
      renameOpen = true;
      moveConfirmOpen = true;
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

{#if storage.activeModal?.type === 'rename'}
  {@const modalPayload = storage.activeModal.payload}
  <RenameModal
    bind:open={renameOpen}
    currentName={keyToName(modalPayload.key)}
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

{#if storage.activeModal?.type === 'resolve-conflicts'}
  {@const modalPayload = storage.activeModal.payload}
  <ConflictResolutionDialog
    bind:open={resolveConflictsOpen}
    entries={modalPayload.entries}
    confirmLabel={modalPayload.confirmLabel}
    onCheckRename={async (entry) => {
      const conn = loadConnectionLocally();
      if (!conn) return true;
      const connHeader = getConnectionHeader(conn);
      try {
        const fullKey = modalPayload.destPrefix + entry.customName.trim();
        return !(await checkObjectExists(modalPayload.bucket, fullKey, connHeader));
      } catch {
        return true;
      }
    }}
    onConfirm={(entries) => storage.confirmConflictResolution(entries)}
    onCancel={() => storage.cancelConflictResolution()}
  />
{/if}
