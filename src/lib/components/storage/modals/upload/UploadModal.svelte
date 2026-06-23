<script lang="ts">
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconDraft from 'virtual:icons/material-symbols/draft';
  import IconUpload from 'virtual:icons/material-symbols/upload';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { checkObjectExists, uploadFile, UploadError } from '$lib/storage/upload.js';
  import { formatFileSize } from '$lib/storage/utils.js';
  import UploadDropzone from './UploadDropzone.svelte';
  import UploadConflictEntry from './UploadConflictEntry.svelte';
  import UploadEntryStatus from './UploadEntryStatus.svelte';
  import type { FileEntry, Phase, Resolution, RenameState } from './types.js';

  interface Props {
    open: boolean;
    bucket: string;
    prefix: string;
    onSuccess: () => void;
  }

  let { open = $bindable(false), bucket, prefix, onSuccess }: Props = $props();

  // ── State ──────────────────────────────────────────────────────────────────

  let phase = $state<Phase>('idle');
  let entries = $state<FileEntry[]>([]);

  let cancelRequested = $state(false);

  // Reset when modal closes.
  $effect(() => {
    if (!open) {
      phase = 'idle';
      entries = [];
    }
  });

  // ── Derived ────────────────────────────────────────────────────────────────

  const conflictEntries = $derived(entries.filter((e) => e.conflict));
  const hasUnresolved = $derived(conflictEntries.some((e) => e.resolution === null));
  // All rename entries must be explicitly confirmed (renameState === 'ok') before uploading.
  const hasUnconfirmedRename = $derived(
    entries.some((e) => e.resolution === 'rename' && e.renameState !== 'ok')
  );
  const canProceed = $derived(!hasUnresolved && !hasUnconfirmedRename);

  const totalSize = $derived(entries.reduce((sum, e) => sum + e.file.size, 0));
  const uploadedCount = $derived(entries.filter((e) => e.status === 'done').length);
  const skippedCount = $derived(entries.filter((e) => e.status === 'skipped').length);
  const errorCount = $derived(entries.filter((e) => e.status === 'error').length);

  // ── Key helpers ────────────────────────────────────────────────────────────

  function buildTargetKey(relativePath: string): string {
    return prefix ? `${prefix}${relativePath}` : relativePath;
  }

  /**
   * Compute the final object key for an entry at upload time.
   * For renamed entries, replaces only the filename segment, preserving any
   * directory prefix within the key.
   */
  function resolvedKey(entry: FileEntry): string {
    if (entry.resolution !== 'rename') return entry.targetKey;
    const slash = entry.targetKey.lastIndexOf('/');
    const dir = slash >= 0 ? entry.targetKey.slice(0, slash + 1) : '';
    return dir + entry.customName.trim();
  }

  // ── Entry construction ─────────────────────────────────────────────────────

  function makeEntries(pairs: { file: File; relativePath: string }[]): FileEntry[] {
    return pairs.map(({ file, relativePath }) => ({
      id: crypto.randomUUID(),
      file,
      displayPath: relativePath,
      targetKey: buildTargetKey(relativePath),
      conflict: false,
      resolution: null,
      customName: file.name,
      renameState: 'idle',
      status: 'pending',
      progress: 0
    }));
  }

  // ── File selection (from UploadDropzone) ───────────────────────────────────

  function handleFilesSelected(pairs: { file: File; relativePath: string }[]) {
    entries = makeEntries(pairs);
    phase = 'selected';
  }

  // ── Upload flow ────────────────────────────────────────────────────────────

  async function startUploadFlow() {
    if (phase !== 'selected') return;
    cancelRequested = false;
    phase = 'checking';

    const results = await Promise.all(
      entries.map(async (e) => {
        try {
          return { id: e.id, conflict: await checkObjectExists(bucket, e.targetKey) };
        } catch {
          return { id: e.id, conflict: false };
        }
      })
    );

    if (cancelRequested) {
      phase = 'idle';
      entries = [];
      return;
    }

    const conflictMap = new Map(results.map((r) => [r.id, r.conflict]));
    entries = entries.map((e) => ({
      ...e,
      conflict: conflictMap.get(e.id) ?? false,
      // Non-conflicting files get a placeholder resolution so they proceed to upload.
      resolution: (conflictMap.get(e.id) ? null : 'replace') as Resolution | null
    }));

    if (entries.some((e) => e.conflict)) {
      phase = 'review';
    } else {
      await doUploadAll();
    }
  }

  async function confirmAndUpload() {
    if (!canProceed) return;
    cancelRequested = false;
    await doUploadAll();
  }

  async function doUploadAll() {
    phase = 'uploading';

    // Mark skipped entries immediately.
    entries = entries.map((e) =>
      e.resolution === 'skip' ? { ...e, status: 'skipped' as const } : e
    );

    const toUpload = entries.filter((e) => e.status !== 'skipped');
    const concurrency = 3;
    for (let i = 0; i < toUpload.length; i += concurrency) {
      if (cancelRequested) {
        const pending = new Set(toUpload.slice(i).map((e) => e.id));
        entries = entries.map((e) =>
          pending.has(e.id) ? { ...e, status: 'skipped' as const } : e
        );
        break;
      }
      await Promise.all(toUpload.slice(i, i + concurrency).map(doUploadEntry));
    }

    if (!cancelRequested) {
      phase = 'complete';
    }
  }

  async function doUploadEntry(entry: FileEntry) {
    const key = resolvedKey(entry);
    entries = entries.map((e) =>
      e.id === entry.id ? { ...e, status: 'uploading' as const, progress: 0 } : e
    );
    try {
      await uploadFile(bucket, key, entry.file, (pct) => {
        entries = entries.map((e) => (e.id === entry.id ? { ...e, progress: pct } : e));
      });
      entries = entries.map((e) =>
        e.id === entry.id ? { ...e, status: 'done' as const, progress: 100 } : e
      );
    } catch (err) {
      const msg =
        err instanceof UploadError ? mapUploadError(err) : m.storage_upload_error_unknown();
      entries = entries.map((e) =>
        e.id === entry.id ? { ...e, status: 'error' as const, errorMessage: msg } : e
      );
    }
  }

  // ── Resolution handlers ────────────────────────────────────────────────────

  function setResolution(id: string, res: Resolution) {
    entries = entries.map((e) =>
      e.id === id
        ? {
            ...e,
            resolution: res,
            renameState: (res === 'rename' ? 'editing' : 'idle') as RenameState
          }
        : e
    );
  }

  function setCustomName(id: string, name: string) {
    // Any edit resets the confirmation state so the user must re-confirm.
    entries = entries.map((e) =>
      e.id === id ? { ...e, customName: name, renameState: 'editing' as const } : e
    );
  }

  /**
   * Two-stage rename button handler:
   *   1st click (not in rename mode)  → enter edit mode
   *   2nd click (editing / conflict)  → check new name against bucket
   *   click when ok                   → re-enter edit mode
   */
  async function handleRenameButtonClick(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    if (entry.resolution !== 'rename') {
      setResolution(id, 'rename');
    } else if (entry.renameState === 'ok') {
      entries = entries.map((e) => (e.id === id ? { ...e, renameState: 'editing' as const } : e));
    } else if (entry.renameState === 'editing' || entry.renameState === 'conflict') {
      await checkRename(id);
    }
  }

  /** Check whether the renamed key already exists in the bucket. */
  async function checkRename(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry || entry.resolution !== 'rename') return;
    // Client-side guard: name must differ from original.
    const newName = entry.customName.trim();
    if (newName === '' || newName === entry.file.name) return;

    entries = entries.map((e) => (e.id === id ? { ...e, renameState: 'checking' as const } : e));
    const newKey = resolvedKey(entry);
    // Session cookie is sent automatically — no connection header needed.
    try {
      const exists = await checkObjectExists(bucket, newKey);
      const nextState: RenameState = exists ? 'conflict' : 'ok';
      entries = entries.map((e) => (e.id === id ? { ...e, renameState: nextState } : e));
    } catch {
      // On network error fall back to editing so the user can retry.
      entries = entries.map((e) => (e.id === id ? { ...e, renameState: 'editing' as const } : e));
    }
  }

  // ── Done / cancel ──────────────────────────────────────────────────────────

  function handleDone() {
    const hasUploads = uploadedCount > 0;
    open = false;
    if (hasUploads) onSuccess();
  }

  function handleCancel() {
    if (phase === 'uploading') {
      cancelRequested = true;
      open = false;
      return;
    }
    cancelRequested = true;
    phase = 'idle';
    entries = [];
    open = false;
  }

  // ── Error mapping ──────────────────────────────────────────────────────────

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
  <div class="modal-box w-full max-w-lg">
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-base-content text-lg font-semibold">
        {m.storage_upload_title()}
      </h2>
      <button
        class="btn btn-ghost btn-sm btn-square"
        onclick={handleCancel}
        aria-label={m.storage_upload_close()}
      >
        <IconClose class="size-5" aria-hidden="true" />
      </button>
    </div>

    <!-- Target prefix info -->
    {#if prefix}
      <p class="text-base-content/50 mb-3 truncate text-xs">
        {m.storage_upload_to_prefix({ prefix })}
      </p>
    {/if}

    <!-- ── idle: drag-and-drop zone ────────────────────────────────────── -->
    {#if phase === 'idle'}
      <UploadDropzone onFilesSelected={handleFilesSelected} />

      <!-- ── selected: file list preview ──────────────────────────────────── -->
    {:else if phase === 'selected'}
      <ul
        class="bg-base-200 divide-base-300 mb-3 max-h-64 divide-y overflow-y-auto rounded-lg"
        aria-label={entries.length === 1
          ? `1 ${m.storage_file()}`
          : `${entries.length} ${m.storage_files()}`}
      >
        {#each entries as entry (entry.id)}
          <li class="flex items-center gap-3 px-4 py-2.5">
            <IconDraft class="text-primary size-5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-sm">{entry.displayPath}</span>
            <span class="text-base-content/50 shrink-0 text-xs"
              >{formatFileSize(entry.file.size)}</span
            >
          </li>
        {/each}
      </ul>
      <p class="text-base-content/50 mb-4 text-xs">
        {entries.length === 1 ? `1 ${m.storage_file()}` : `${entries.length} ${m.storage_files()}`}
        &nbsp;&middot;&nbsp;{m.storage_upload_total_size({
          size: formatFileSize(totalSize)
        })}
      </p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
        <button class="btn btn-primary btn-sm gap-1" onclick={startUploadFlow}>
          <IconUpload class="size-4" aria-hidden="true" />
          {m.storage_upload_start()}
        </button>
      </div>

      <!-- ── checking ─────────────────────────────────────────────────────── -->
    {:else if phase === 'checking'}
      <div class="flex flex-col items-center justify-center gap-3 py-8" aria-live="polite">
        <span class="loading loading-spinner loading-sm text-primary" aria-hidden="true"></span>
        <span class="text-base-content/60 text-sm">{m.storage_upload_checking()}</span>
        <button class="btn btn-ghost btn-sm mt-2" onclick={handleCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
      </div>

      <!-- ── review: conflict resolution ──────────────────────────────────── -->
    {:else if phase === 'review'}
      <div class="mb-3 flex items-start gap-2">
        <IconWarning class="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p class="text-base-content font-semibold">{m.storage_upload_conflicts_title()}</p>
          <p class="text-base-content/60 mt-0.5 text-sm">{m.storage_upload_conflicts_desc()}</p>
        </div>
      </div>

      <ul
        class="border-base-300 mb-4 max-h-72 divide-y overflow-y-auto rounded-lg border"
        aria-label={m.storage_upload_conflicts_title()}
      >
        {#each conflictEntries as entry (entry.id)}
          <UploadConflictEntry
            {entry}
            onSetResolution={(res) => setResolution(entry.id, res)}
            onSetCustomName={(name) => setCustomName(entry.id, name)}
            onRenameButtonClick={() => handleRenameButtonClick(entry.id)}
            onCheckRename={() => checkRename(entry.id)}
          />
        {/each}
      </ul>

      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
        <button
          class="btn btn-primary btn-sm gap-1"
          onclick={confirmAndUpload}
          disabled={!canProceed}
          aria-disabled={!canProceed}
        >
          <IconUpload class="size-4" aria-hidden="true" />
          {m.storage_upload_start()}
        </button>
      </div>

      <!-- ── uploading ─────────────────────────────────────────────────────── -->
    {:else if phase === 'uploading'}
      <ul
        class="border-base-300 mb-3 max-h-72 divide-y overflow-y-auto rounded-lg border"
        aria-label={m.storage_upload_title()}
        aria-live="polite"
      >
        {#each entries as entry (entry.id)}
          <UploadEntryStatus {entry} />
        {/each}
      </ul>
      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
      </div>

      <!-- ── complete ───────────────────────────────────────────────────────── -->
    {:else if phase === 'complete'}
      <div class="mb-4 flex items-center gap-3 py-2" role="status">
        <IconCheckCircle class="text-success size-10 shrink-0" aria-hidden="true" />
        <div>
          <p class="text-base-content font-semibold">{m.storage_upload_complete_title()}</p>
          <p class="text-base-content/60 mt-0.5 text-sm">
            {m.storage_upload_complete_summary({
              uploaded: uploadedCount,
              skipped: skippedCount,
              failed: errorCount
            })}
          </p>
        </div>
      </div>

      {#if errorCount > 0}
        <ul
          class="bg-error/10 mb-4 max-h-40 overflow-y-auto rounded-lg px-3 py-2"
          aria-label={m.storage_upload_status_failed()}
        >
          {#each entries.filter((e) => e.status === 'error') as entry (entry.id)}
            {@const errName =
              entry.resolution === 'rename' && entry.customName.trim()
                ? entry.customName.trim()
                : (entry.targetKey.split('/').at(-1) ?? entry.file.name)}
            <li class="text-error py-1 text-xs">
              {errName}: {entry.errorMessage}
            </li>
          {/each}
        </ul>
      {/if}

      <div class="flex justify-end">
        <button class="btn btn-primary btn-sm" onclick={handleDone}>
          {m.storage_upload_done()}
        </button>
      </div>
    {/if}
  </div>
</Modal>
