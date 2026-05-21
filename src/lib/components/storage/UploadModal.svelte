<script lang="ts">
  import Icon from '@iconify/svelte';
  import prettyBytes from 'pretty-bytes';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { checkObjectExists, uploadFile, UploadError } from '$lib/storage/upload.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  interface Props {
    open: boolean;
    bucket: string;
    prefix: string;
    onSuccess: () => void;
  }

  let { open = $bindable(false), bucket, prefix, onSuccess }: Props = $props();

  const uid = $props.id();

  // ── Types ──────────────────────────────────────────────────────────────────

  type Resolution = 'replace' | 'skip' | 'rename';

  /**
   * Tracks the two-stage rename confirmation flow.
   * idle      – rename not selected for this entry
   * editing   – rename selected, text field is editable
   * checking  – async conflict check in progress
   * ok        – new name confirmed available
   * conflict  – new name already exists in the bucket
   */
  type RenameState = 'idle' | 'editing' | 'checking' | 'ok' | 'conflict';

  type FileEntry = {
    id: string;
    file: File;
    /** Relative display path (without bucket prefix). */
    displayPath: string;
    /** Full object key in the bucket. */
    targetKey: string;
    conflict: boolean;
    resolution: Resolution | null;
    /** Editable filename when the user chooses to rename. */
    customName: string;
    renameState: RenameState;
    status: 'pending' | 'uploading' | 'done' | 'error' | 'skipped';
    progress: number;
    errorMessage?: string;
  };

  type Phase = 'idle' | 'selected' | 'checking' | 'review' | 'uploading' | 'complete';

  // ── State ──────────────────────────────────────────────────────────────────

  let phase = $state<Phase>('idle');
  let entries = $state<FileEntry[]>([]);
  let dragOver = $state(false);
  let fileInputEl: HTMLInputElement | null = $state(null);
  let dirInputEl: HTMLInputElement | null = $state(null);

  // Set webkitdirectory on the folder input (non-standard, but widely supported in Firefox/Chromium).
  $effect(() => {
    dirInputEl?.setAttribute('webkitdirectory', '');
  });

  // Reset when modal closes.
  $effect(() => {
    if (!open) {
      phase = 'idle';
      entries = [];
      dragOver = false;
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

  // ── File selection ─────────────────────────────────────────────────────────

  function handleInputChange(e: Event) {
    const list = (e.target as HTMLInputElement).files;
    if (!list || list.length === 0) return;
    const pairs = Array.from(list).map((f) => ({
      file: f,
      relativePath: f.webkitRelativePath || f.name
    }));
    entries = makeEntries(pairs);
    phase = 'selected';
    // Reset the input so the same selection can be re-triggered.
    (e.target as HTMLInputElement).value = '';
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const dt = e.dataTransfer;
    if (!dt) return;

    let pairs: { file: File; relativePath: string }[];
    try {
      pairs = await collectDroppedFiles(dt);
    } catch {
      // Fallback if the FileSystem API is unavailable.
      pairs = Array.from(dt.files).map((f) => ({ file: f, relativePath: f.name }));
    }

    if (pairs.length === 0) return;
    entries = makeEntries(pairs);
    phase = 'selected';
  }

  // ── Directory traversal ────────────────────────────────────────────────────

  async function collectDroppedFiles(
    dt: DataTransfer
  ): Promise<{ file: File; relativePath: string }[]> {
    // Collect FileSystemEntry for each dropped item once (single-use in some browsers).
    const fsEntries = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.() ?? null);

    // If no directories are present, skip async traversal.
    if (!fsEntries.some((e) => e?.isDirectory)) {
      return Array.from(dt.files).map((f) => ({ file: f, relativePath: f.name }));
    }

    const results: { file: File; relativePath: string }[] = [];
    for (const entry of fsEntries) {
      if (entry) {
        results.push(...(await traverseEntry(entry, '')));
      }
    }
    return results;
  }

  async function traverseEntry(
    entry: FileSystemEntry,
    base: string
  ): Promise<{ file: File; relativePath: string }[]> {
    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        (entry as FileSystemFileEntry).file(
          (f) => resolve([{ file: f, relativePath: base + entry.name }]),
          reject
        );
      });
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await drainReader(reader);
      const newBase = base + entry.name + '/';
      const nested = await Promise.all(children.map((c) => traverseEntry(c, newBase)));
      return nested.flat();
    }
    return [];
  }

  async function drainReader(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      all.push(...batch);
    } while (batch.length > 0);
    return all;
  }

  // ── Upload flow ────────────────────────────────────────────────────────────

  async function startUploadFlow() {
    if (phase !== 'selected') return;
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
      await Promise.all(toUpload.slice(i, i + concurrency).map(doUploadEntry));
    }

    phase = 'complete';
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
    if (phase === 'uploading') return;
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
        disabled={phase === 'uploading'}
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
    {#if phase === 'idle'}
      <!-- Hidden inputs: one for multiple files, one for a directory -->
      <input
        bind:this={fileInputEl}
        id="{uid}-files"
        type="file"
        class="sr-only"
        multiple
        onchange={handleInputChange}
        aria-label={m.storage_upload_select_files()}
      />
      <input
        bind:this={dirInputEl}
        id="{uid}-dir"
        type="file"
        class="sr-only"
        onchange={handleInputChange}
        aria-label={m.storage_upload_select_folder()}
      />

      <!-- Drop zone -->
      <div
        role="button"
        tabindex="0"
        class="
          border-base-300 hover:border-primary/60 hover:bg-primary/5 mb-4 flex cursor-pointer
          flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12
          transition-colors
          {dragOver ? 'border-primary bg-primary/5' : ''}
        "
        aria-label={m.storage_upload_drop_prompt()}
        onclick={() => fileInputEl?.click()}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputEl?.click()}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        ondrop={handleDrop}
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

      <!-- Picker buttons -->
      <div class="flex justify-center gap-3">
        <button class="btn btn-ghost btn-sm gap-1.5" onclick={() => fileInputEl?.click()}>
          <Icon icon="material-symbols:file-copy-outline" class="size-4" aria-hidden="true" />
          {m.storage_upload_select_files()}
        </button>
        <button class="btn btn-ghost btn-sm gap-1.5" onclick={() => dirInputEl?.click()}>
          <Icon icon="material-symbols:folder-open" class="size-4" aria-hidden="true" />
          {m.storage_upload_select_folder()}
        </button>
      </div>

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
            <Icon
              icon="material-symbols:draft"
              class="text-primary size-5 shrink-0"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate text-sm">{entry.displayPath}</span>
            <span class="text-base-content/50 shrink-0 text-xs"
              >{prettyBytes(entry.file.size, { locale: getLocale(), fixedWidth: 9 })}</span
            >
          </li>
        {/each}
      </ul>
      <p class="text-base-content/50 mb-4 text-xs">
        {entries.length === 1 ? `1 ${m.storage_file()}` : `${entries.length} ${m.storage_files()}`}
        &nbsp;&middot;&nbsp;{m.storage_upload_total_size({
          size: prettyBytes(totalSize, { locale: getLocale(), fixedWidth: 9 })
        })}
      </p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" onclick={handleCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
        <button class="btn btn-primary btn-sm gap-1" onclick={startUploadFlow}>
          <Icon icon="material-symbols:upload" class="size-4" aria-hidden="true" />
          {m.storage_upload_start()}
        </button>
      </div>

      <!-- ── checking ─────────────────────────────────────────────────────── -->
    {:else if phase === 'checking'}
      <div class="flex items-center justify-center gap-3 py-8" aria-live="polite">
        <span class="loading loading-spinner loading-sm text-primary" aria-hidden="true"></span>
        <span class="text-base-content/60 text-sm">{m.storage_upload_checking()}</span>
      </div>

      <!-- ── review: conflict resolution ──────────────────────────────────── -->
    {:else if phase === 'review'}
      <div class="mb-3 flex items-start gap-2">
        <Icon
          icon="material-symbols:warning"
          class="text-warning mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
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
          {@const nameOnly = entry.targetKey.split('/').at(-1) ?? entry.file.name}
          {@const badRename =
            entry.resolution === 'rename' &&
            (entry.customName.trim() === '' || entry.customName.trim() === entry.file.name)}
          <li class="px-4 py-3">
            <p class="text-base-content mb-2 truncate text-sm font-medium">
              &ldquo;{nameOnly}&rdquo;
            </p>
            <!-- Resolution toggle buttons -->
            <div
              class="flex flex-wrap gap-1.5"
              role="group"
              aria-label="{m.storage_upload_conflicts_title()} — {nameOnly}"
            >
              <button
                class="btn btn-xs {entry.resolution === 'replace' ? 'btn-warning' : 'btn-ghost'}"
                onclick={() => setResolution(entry.id, 'replace')}
                aria-pressed={entry.resolution === 'replace'}
              >
                {m.storage_upload_resolution_replace()}
              </button>
              <button
                class="btn btn-xs {entry.resolution === 'skip' ? 'btn-neutral' : 'btn-ghost'}"
                onclick={() => setResolution(entry.id, 'skip')}
                aria-pressed={entry.resolution === 'skip'}
              >
                {m.storage_upload_resolution_skip()}
              </button>
              <button
                class="btn btn-xs gap-1 {entry.resolution !== 'rename'
                  ? 'btn-ghost'
                  : entry.renameState === 'ok'
                    ? 'btn-success'
                    : entry.renameState === 'conflict'
                      ? 'btn-error'
                      : 'btn-primary'}"
                onclick={() => handleRenameButtonClick(entry.id)}
                aria-pressed={entry.resolution === 'rename'}
                disabled={entry.renameState === 'checking'}
              >
                {#if entry.resolution === 'rename' && entry.renameState === 'checking'}
                  <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                {:else if entry.resolution === 'rename' && entry.renameState === 'ok'}
                  <Icon icon="material-symbols:check" class="size-3" aria-hidden="true" />
                {/if}
                {#if entry.resolution === 'rename' && (entry.renameState === 'editing' || entry.renameState === 'conflict')}
                  {m.storage_upload_rename_confirm_action()}
                {:else}
                  {m.storage_upload_resolution_rename()}
                {/if}
              </button>
            </div>

            <!-- Name field: real <input> only while editing; static display otherwise -->
            <div class="mt-2">
              {#if entry.resolution === 'rename' && (entry.renameState === 'editing' || entry.renameState === 'conflict')}
                <label for="{uid}-rename-{entry.id}" class="label sr-only">
                  {m.storage_upload_rename_label()}
                </label>
                <input
                  id="{uid}-rename-{entry.id}"
                  type="text"
                  class="input input-sm w-full {badRename || entry.renameState === 'conflict'
                    ? 'input-error'
                    : ''}"
                  value={entry.customName}
                  oninput={(e) => setCustomName(entry.id, (e.target as HTMLInputElement).value)}
                  onkeydown={(e) => e.key === 'Enter' && void checkRename(entry.id)}
                  placeholder={m.storage_upload_rename_label()}
                  aria-describedby={badRename || entry.renameState === 'conflict'
                    ? `${uid}-rename-err-${entry.id}`
                    : undefined}
                />
                {#if badRename}
                  <p id="{uid}-rename-err-{entry.id}" class="text-error mt-1 text-xs" role="alert">
                    {m.storage_upload_rename_same_name_error()}
                  </p>
                {:else if entry.renameState === 'conflict'}
                  <p id="{uid}-rename-err-{entry.id}" class="text-error mt-1 text-xs" role="alert">
                    {m.storage_upload_rename_taken()}
                  </p>
                {/if}
              {:else}
                <!-- Static display: not in rename mode, or confirmed/checking -->
                <div class="text-base-content/50 mt-1 flex items-center gap-1 px-1 text-sm">
                  <span class="min-w-0 flex-1 truncate">{entry.customName}</span>
                  {#if entry.resolution === 'rename' && entry.renameState === 'ok'}
                    <Icon
                      icon="material-symbols:check-circle"
                      class="text-success size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  {/if}
                </div>
              {/if}
            </div>
          </li>
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
          <Icon icon="material-symbols:upload" class="size-4" aria-hidden="true" />
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
          {@const nameOnly =
            entry.resolution === 'rename' && entry.customName.trim()
              ? entry.customName.trim()
              : (entry.targetKey.split('/').at(-1) ?? entry.file.name)}
          <li class="px-4 py-2.5">
            <div class="flex items-center gap-2 text-sm">
              {#if entry.status === 'done'}
                <Icon
                  icon="material-symbols:check-circle"
                  class="text-success size-4 shrink-0"
                  aria-hidden="true"
                />
              {:else if entry.status === 'error'}
                <Icon
                  icon="material-symbols:error"
                  class="text-error size-4 shrink-0"
                  aria-hidden="true"
                />
              {:else if entry.status === 'skipped'}
                <Icon
                  icon="material-symbols:block"
                  class="text-base-content/30 size-4 shrink-0"
                  aria-hidden="true"
                />
              {:else if entry.status === 'uploading'}
                <span
                  class="loading loading-spinner loading-xs text-primary shrink-0"
                  aria-hidden="true"
                ></span>
              {:else}
                <Icon
                  icon="material-symbols:schedule"
                  class="text-base-content/30 size-4 shrink-0"
                  aria-hidden="true"
                />
              {/if}
              <span class="min-w-0 flex-1 truncate">{nameOnly}</span>
              <span class="text-base-content/50 shrink-0 text-xs">
                {#if entry.status === 'uploading'}
                  {entry.progress}%
                {:else if entry.status === 'done'}
                  {m.storage_upload_status_done()}
                {:else if entry.status === 'skipped'}
                  {m.storage_upload_status_skipped()}
                {:else if entry.status === 'error'}
                  {m.storage_upload_status_failed()}
                {:else}
                  {m.storage_upload_status_queued()}
                {/if}
              </span>
            </div>
            {#if entry.status === 'uploading'}
              <progress
                class="progress progress-primary mt-1.5 w-full"
                value={entry.progress}
                max="100"
                aria-valuenow={entry.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              ></progress>
            {/if}
            {#if entry.status === 'error' && entry.errorMessage}
              <p class="text-error mt-1 text-xs">{entry.errorMessage}</p>
            {/if}
          </li>
        {/each}
      </ul>

      <!-- ── complete ───────────────────────────────────────────────────────── -->
    {:else if phase === 'complete'}
      <div class="mb-4 flex items-center gap-3 py-2" role="status">
        <Icon
          icon="line-md:circle-filled-to-confirm-circle-filled-transition"
          class="text-success size-10 shrink-0"
          aria-hidden="true"
        />
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
