<script lang="ts">
  import Icon from '@iconify/svelte';
  import prettyBytes from 'pretty-bytes';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { checkObjectExists, uploadFile, UploadError } from '$lib/storage/upload.js';

  interface Props {
    open: boolean;
    bucket: string;
    prefix: string;
    onSuccess: () => void;
  }

  let { open = $bindable(false), bucket, prefix, onSuccess }: Props = $props();

  const uid = $props.id();

  // ── State machine ─────────────────────────────────────────────────────────

  type UploadState =
    | { kind: 'idle' }
    | { kind: 'file_selected'; file: File }
    | { kind: 'checking'; file: File }
    | { kind: 'confirming_overwrite'; file: File; targetKey: string; renaming: boolean }
    | { kind: 'uploading'; file: File; targetKey: string; progress: number }
    | { kind: 'success' }
    | { kind: 'error'; file: File; targetKey: string; message: string };

  let phase: UploadState = $state.raw({ kind: 'idle' });
  let dragOver = $state(false);
  let fileInputEl: HTMLInputElement | null = $state(null);
  let newName = $state('');

  // Reset when modal closes
  $effect(() => {
    if (!open) {
      phase = { kind: 'idle' };
      dragOver = false;
    }
  });

  function targetKey(file: File): string {
    return prefix ? `${prefix}${file.name}` : file.name;
  }

  // ── File selection ─────────────────────────────────────────────────────────

  function handleFileSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    phase = { kind: 'file_selected', file };
  }

  function handleInputChange(e: Event) {
    handleFileSelected((e.target as HTMLInputElement).files);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    handleFileSelected(e.dataTransfer?.files ?? null);
  }

  function openFilePicker() {
    fileInputEl?.click();
  }

  // ── Upload flow ────────────────────────────────────────────────────────────

  async function startUploadFlow() {
    if (phase.kind !== 'file_selected') return;
    const { file } = phase;
    const key = targetKey(file);
    phase = { kind: 'checking', file };

    try {
      const exists = await checkObjectExists(bucket, key);
      if (exists) {
        newName = file.name;
        phase = { kind: 'confirming_overwrite', file, targetKey: key, renaming: false };
      } else {
        await doUpload(file, key);
      }
    } catch (err) {
      phase = {
        kind: 'error',
        file,
        targetKey: key,
        message: err instanceof UploadError ? mapUploadError(err) : m.storage_upload_error_unknown()
      };
    }
  }

  async function doUpload(file: File, key: string) {
    phase = { kind: 'uploading', file, targetKey: key, progress: 0 };
    try {
      await uploadFile(bucket, key, file, (pct) => {
        if (phase.kind === 'uploading') {
          phase = { ...phase, progress: pct };
        }
      });
      phase = { kind: 'success' };
    } catch (err) {
      phase = {
        kind: 'error',
        file,
        targetKey: key,
        message: err instanceof UploadError ? mapUploadError(err) : m.storage_upload_error_unknown()
      };
    }
  }

  function handleReplace() {
    if (phase.kind !== 'confirming_overwrite') return;
    void doUpload(phase.file, phase.targetKey);
  }

  function handleRenameToggle() {
    if (phase.kind !== 'confirming_overwrite') return;
    phase = { ...phase, renaming: true };
  }

  function handleRenameConfirm() {
    if (phase.kind !== 'confirming_overwrite') return;
    const key = prefix ? `${prefix}${newName}` : newName;
    void doUpload(phase.file, key);
  }

  function handleSuccess() {
    open = false;
    onSuccess();
  }

  function handleRetry() {
    if (phase.kind !== 'error') return;
    phase = { kind: 'file_selected', file: phase.file };
  }

  function handleCancel() {
    phase = { kind: 'idle' };
    open = false;
  }

  function mapUploadError(err: UploadError): string {
    switch (err.code) {
      case 'not_connected':
        return m.storage_upload_error_not_connected();
      case 'access_denied':
        return m.storage_upload_error_access_denied();
      case 'no_such_bucket':
        return m.storage_upload_error_no_such_bucket();
      case 'invalid_part':
        return m.storage_upload_error_invalid_part();
      case 'server_error':
        return m.storage_upload_error_server_error();
      default:
        return m.storage_upload_error_unknown();
    }
  }
</script>

<Modal bind:open class="modal">
  <div class="modal-box w-full max-w-md">
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-base-content text-lg font-semibold">
        {m.storage_upload_title()}
      </h2>
      <button
        class="btn btn-ghost btn-sm btn-square"
        onclick={handleCancel}
        disabled={phase.kind === 'uploading'}
        aria-label={m.storage_upload_close()}
      >
        <Icon icon="material-symbols:close" class="size-5" aria-hidden="true" />
      </button>
    </div>

    <!-- Target prefix info -->
    {#if prefix}
      <p class="text-base-content/50 mb-3 truncate text-xs">
        {m.storage_upload_to_prefix({ prefix })}
      </p>
    {/if}

    <!-- ── idle: drag-and-drop zone ────────────────────────────────────── -->
    {#if phase.kind === 'idle'}
      <!-- Hidden file input -->
      <input
        bind:this={fileInputEl}
        id="{uid}-file"
        type="file"
        class="sr-only"
        onchange={handleInputChange}
        aria-label={m.storage_upload_drop_prompt()}
      />

      <!-- Drop zone -->
      <div
        role="button"
        class="
          border-base-300 hover:border-primary/60 hover:bg-primary/5 flex cursor-pointer
          flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 transition-colors
          {dragOver ? 'border-primary bg-primary/5' : ''}
        "
        aria-label={m.storage_upload_drop_prompt()}
        onclick={openFilePicker}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ' ? openFilePicker() : null)}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        ondrop={handleDrop}
        tabindex="0"
      >
        <Icon
          icon="material-symbols:upload-file"
          class="text-base-content/30 size-12"
          aria-hidden="true"
        />
        <p class="text-base-content/60 text-center text-sm">
          {m.storage_upload_drop_prompt()}
        </p>
      </div>

      <!-- ── file_selected ────────────────────────────────────────────────── -->
    {:else if phase.kind === 'file_selected'}
      <div class="bg-base-200 mb-4 flex items-center gap-3 rounded-lg px-4 py-3">
        <Icon
          icon="material-symbols:draft"
          class="text-primary size-8 shrink-0"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="text-base-content truncate text-sm font-medium">{phase.file.name}</p>
          <p class="text-base-content/50 text-xs">{prettyBytes(phase.file.size)}</p>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
        <button class="btn btn-primary btn-sm gap-1" onclick={startUploadFlow}>
          <Icon icon="material-symbols:upload" class="size-4" aria-hidden="true" />
          {m.storage_action_upload()}
        </button>
      </div>

      <!-- ── checking ─────────────────────────────────────────────────────── -->
    {:else if phase.kind === 'checking'}
      <div class="flex items-center justify-center gap-3 py-8" aria-live="polite">
        <span class="loading loading-spinner loading-sm text-primary" aria-hidden="true"></span>
        <span class="text-base-content/60 text-sm">{m.storage_upload_checking()}</span>
      </div>

      <!-- ── confirming_overwrite ─────────────────────────────────────────── -->
    {:else if phase.kind === 'confirming_overwrite'}
      <div class="mb-4 flex items-start gap-3">
        <Icon
          icon="material-symbols:warning"
          class="text-warning mt-0.5 size-6 shrink-0"
          aria-hidden="true"
        />
        <div>
          <p class="text-base-content font-semibold">{m.storage_upload_overwrite_title()}</p>
          <p class="text-base-content/60 mt-1 text-sm">
            {m.storage_upload_overwrite_message({ name: phase.file.name })}
          </p>
        </div>
      </div>

      {#if phase.renaming}
        <!-- Rename input -->
        <div class="mb-4">
          <label for="{uid}-newname" class="label mb-1 text-sm">
            {m.storage_upload_rename_label()}
          </label>
          <input
            id="{uid}-newname"
            type="text"
            class="input input-sm w-full"
            bind:value={newName}
            onkeydown={(e) => (e.key === 'Enter' ? handleRenameConfirm() : null)}
          />
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
            {m.storage_upload_overwrite_cancel()}
          </button>
          <button
            class="btn btn-primary btn-sm gap-1"
            onclick={handleRenameConfirm}
            disabled={!newName.trim()}
          >
            <Icon icon="material-symbols:upload" class="size-4" aria-hidden="true" />
            {m.storage_upload_rename_confirm()}
          </button>
        </div>
      {:else}
        <div class="flex justify-end gap-2">
          <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
            {m.storage_upload_overwrite_cancel()}
          </button>
          <button class="btn btn-ghost btn-sm" onclick={handleRenameToggle}>
            {m.storage_upload_overwrite_rename()}
          </button>
          <button class="btn btn-warning btn-sm gap-1" onclick={handleReplace}>
            <Icon icon="material-symbols:upload" class="size-4" aria-hidden="true" />
            {m.storage_upload_overwrite_replace()}
          </button>
        </div>
      {/if}

      <!-- ── uploading ─────────────────────────────────────────────────────── -->
    {:else if phase.kind === 'uploading'}
      <div
        class="py-4"
        aria-live="polite"
        aria-label={m.storage_upload_uploading({ pct: phase.progress })}
      >
        <div class="mb-2 flex items-center justify-between text-sm">
          <span class="text-base-content/60 truncate">{phase.targetKey.split('/').at(-1)}</span>
          <span class="text-base-content/60 ml-2 shrink-0">{phase.progress}%</span>
        </div>
        <progress
          class="progress progress-primary w-full"
          value={phase.progress}
          max="100"
          aria-valuenow={phase.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        ></progress>
        <p class="text-base-content/40 mt-2 text-center text-xs">
          {m.storage_upload_uploading({ pct: phase.progress })}
        </p>
      </div>

      <!-- ── success ───────────────────────────────────────────────────────── -->
    {:else if phase.kind === 'success'}
      <div class="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <Icon
          icon="line-md:circle-filled-to-confirm-circle-filled-transition"
          class="text-success size-12"
          aria-hidden="true"
        />
        <p class="text-base-content font-semibold">{m.storage_upload_success()}</p>
      </div>
      <div class="flex justify-end">
        <button class="btn btn-primary btn-sm" onclick={handleSuccess}>
          {m.storage_upload_close()}
        </button>
      </div>

      <!-- ── error ─────────────────────────────────────────────────────────── -->
    {:else if phase.kind === 'error'}
      <div class="mb-4 flex items-start gap-3" role="alert">
        <Icon icon="line-md:alert" class="text-error mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <p class="text-base-content/80 text-sm">{phase.message}</p>
      </div>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
        <button class="btn btn-primary btn-sm gap-1" onclick={handleRetry}>
          <Icon icon="material-symbols:refresh" class="size-4" aria-hidden="true" />
          {m.storage_upload_retry()}
        </button>
      </div>
    {/if}
  </div>
</Modal>
