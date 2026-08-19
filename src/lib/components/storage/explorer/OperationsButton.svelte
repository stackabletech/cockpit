<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { StorageOperation, OperationType } from '$lib/storage/types.js';
  import IconContentPaste from 'virtual:icons/material-symbols/content-paste';
  import IconDriveFileMove from 'virtual:icons/material-symbols/drive-file-move-outline';
  import IconEdit from 'virtual:icons/material-symbols/edit-outline';
  import IconDelete from 'virtual:icons/material-symbols/delete-outline';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle-outline';
  import IconError from 'virtual:icons/material-symbols/error-outline';
  import IconCancel from 'virtual:icons/material-symbols/cancel-outline';
  import IconPowerOff from 'virtual:icons/material-symbols/power-off';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconDeleteSweep from 'virtual:icons/material-symbols/delete-sweep-outline';
  import IconHistory from 'virtual:icons/material-symbols/history';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import IconDownload from 'virtual:icons/material-symbols/download';

  const storage = getStorageState();

  const typeIconMap: Record<OperationType, typeof IconDelete> = {
    paste: IconContentPaste,
    move: IconDriveFileMove,
    rename: IconEdit,
    delete: IconDelete,
    download: IconDownload
  };

  let dropdownOpen = $state(false);
  let tick = $state(0);
  let expandedOps: Record<string, boolean> = $state({});
  let dropdownEl: HTMLDivElement | undefined = $state();

  interface ChunkTrack {
    prevBytes: number;
    chunkStart: number;
    chunkBytes: number;
  }
  let chunkTracks: Record<string, ChunkTrack> = {};

  $effect(() => {
    if (!storage.hasRunningOps) return;
    const hasByteProgress = storage.operations.some(
      (op) => op.status === 'running' && op.totalBytes > 0
    );
    const intervalMs = hasByteProgress ? 100 : 1000;
    const id = setInterval(() => {
      tick++;
      for (const op of storage.operations) {
        if (op.status !== 'running' || op.totalBytes <= 0) continue;
        const track = chunkTracks[op.id];
        if (!track) {
          chunkTracks[op.id] = {
            prevBytes: op.completedBytes,
            chunkStart: Date.now(),
            chunkBytes: 0
          };
        } else if (op.completedBytes !== track.prevBytes) {
          const diff = op.completedBytes - track.prevBytes;
          track.prevBytes = op.completedBytes;
          track.chunkBytes = diff;
          track.chunkStart = Date.now();
        }
      }
    }, intervalMs);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (!storage.operations.some((op) => op.type === 'download' && op.cacheExpiresAt)) return;
    const id = setInterval(() => tick++, 1_000);
    return () => clearInterval(id);
  });

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
  }

  function toggleExpand(opId: string) {
    expandedOps = { ...expandedOps, [opId]: !expandedOps[opId] };
  }

  const activeOps = $derived(storage.operations.filter((op) => op.status === 'running'));
  const historyOps = $derived(
    storage.operations
      .filter((op) => op.status !== 'running')
      .slice()
      .reverse()
  );
  const hasHistory = $derived(historyOps.length > 0);
  const hasError = $derived(storage.operations.some((o) => o.status === 'error'));

  function statusColor(op: StorageOperation): string {
    switch (op.status) {
      case 'running':
        return 'text-primary';
      case 'done':
        return 'text-success';
      case 'cancelled':
        return 'text-base-content/40';
      case 'interrupted':
        return 'text-warning';
      default:
        return 'text-error';
    }
  }

  function statusBgColor(op: StorageOperation): string {
    switch (op.status) {
      case 'running':
        return 'bg-primary/10';
      case 'done':
        return 'bg-success/10';
      case 'cancelled':
        return 'bg-base-content/5';
      case 'interrupted':
        return 'bg-warning/10';
      default:
        return 'bg-error/10';
    }
  }

  function statusLabel(op: StorageOperation): string {
    switch (op.status) {
      case 'done':
        return m.storage_operation_done();
      case 'cancelled':
        return m.storage_operation_cancelled();
      case 'interrupted':
        return m.storage_operation_interrupted();
      default:
        return op.errorMessage ?? m.storage_operation_failed();
    }
  }

  function formatElapsed(startedAt: number, completedAt: number | undefined): string {
    void tick;
    const end = completedAt ?? Date.now();
    const seconds = Math.floor((end - startedAt) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * Return an interpolated completedBytes that smooths over chunk boundaries.
   * When a new chunk completes (a jump in completedBytes), this converges
   * smoothly from the previous value to the new one over ~1.5s instead of
   * snapping, giving a smoother visual for multipart S3 copy operations
   * where each part is 256 MB.
   */
  function displayBytes(op: StorageOperation): number {
    if (op.status !== 'running' || op.totalBytes <= 0) return op.completedBytes;
    void tick;
    const track = chunkTracks[op.id];
    if (!track || track.chunkBytes <= 0) return op.completedBytes;
    const elapsed = (Date.now() - track.chunkStart) / 1000;
    const expectedDuration = 1.5;
    const progress = Math.min(1, elapsed / expectedDuration);
    const chunkProgress = track.chunkBytes * progress;
    return Math.min(track.prevBytes, track.prevBytes - track.chunkBytes + chunkProgress);
  }

  function percent(op: StorageOperation): number {
    if (op.totalBytes <= 0) return 0;
    const bytes = displayBytes(op);
    return Math.min(100, Math.round((bytes / op.totalBytes) * 100));
  }

  function progressLabel(op: StorageOperation): string {
    if (op.totalBytes > 0) {
      return `${formatBytes(displayBytes(op))} / ${formatBytes(op.totalBytes)}`;
    }
    if (op.itemCount > 1) {
      return `${op.completedCount} / ${op.itemCount}`;
    }
    return '';
  }

  function speedLabel(op: StorageOperation): string {
    void tick;
    const elapsed = (Date.now() - op.startedAt) / 1000;
    if (elapsed <= 0 || op.completedBytes <= 0) return '';
    const bytesPerSec = op.completedBytes / elapsed;
    return `${formatBytes(Math.round(bytesPerSec))}/s`;
  }

  function etaLabel(op: StorageOperation): string {
    void tick;
    const elapsed = (Date.now() - op.startedAt) / 1000;
    if (elapsed <= 0 || op.completedBytes <= 0 || op.totalBytes <= 0) return '';
    const bytesPerSec = op.completedBytes / elapsed;
    const remaining = op.totalBytes - op.completedBytes;
    if (remaining <= 0) return '';
    const secs = remaining / bytesPerSec;
    if (secs < 60) return `${Math.round(secs)}s`;
    return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  }

  function speedEtaLabel(op: StorageOperation): string {
    if (op.phase === 'compressing') return m.storage_operations_compressing();
    const s = speedLabel(op);
    const e = etaLabel(op);
    if (!s && !e) return '';
    if (s && e)
      return `${m.storage_operations_speed()}: ${s} | ${e} ${m.storage_operations_remaining()}`;
    if (s) return `${m.storage_operations_speed()}: ${s}`;
    return `${e} ${m.storage_operations_remaining()}`;
  }

  function downloadIsCached(op: StorageOperation): boolean {
    void tick;
    return op.cacheExpiresAt !== undefined && op.cacheExpiresAt > Date.now();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (dropdownOpen = false)} />

{#if storage.operations.length > 0}
  {#if dropdownOpen}
    <div
      class="fixed inset-0 z-40"
      onclick={() => (dropdownOpen = false)}
      role="presentation"
      aria-hidden="true"
    ></div>
  {/if}
  <div bind:this={dropdownEl} class="relative z-50 inline-flex">
    <!-- Trigger button -->
    <div class="tooltip tooltip-bottom" data-tip={m.storage_operations_label()}>
      <button
        class="
          btn btn-ghost btn-xs relative size-7 rounded-full p-0
          {storage.hasRunningOps ? 'text-primary' : hasError ? 'text-error' : 'text-success'}
        "
        aria-label={m.storage_operations_label()}
        aria-expanded={dropdownOpen}
        aria-haspopup="menu"
        onclick={toggleDropdown}
      >
        {#if storage.hasRunningOps}
          <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          {#if activeOps.length > 1}
            <span
              class="badge badge-primary badge-xs absolute -top-1 -right-1 min-w-4 px-0.5 text-[9px]"
              aria-hidden="true"
            >
              {activeOps.length}
            </span>
          {/if}
        {:else if hasError}
          <IconError class="size-4" aria-hidden="true" />
        {:else}
          <IconCheckCircle class="size-4" aria-hidden="true" />
        {/if}
      </button>
    </div>

    <!-- Dropdown panel -->
    {#if dropdownOpen}
      <div
        role="menu"
        aria-label={m.storage_operations_label()}
        class="rounded-box border-base-300 bg-base-100 absolute right-0 z-60 mt-2 w-96 origin-top-right border shadow-xl"
      >
        <!-- Active operations section -->
        {#if activeOps.length > 0}
          <div class="border-base-300 border-b px-3 pt-3 pb-2">
            <p
              class="text-base-content/50 mb-2 text-[10px] font-semibold tracking-widest uppercase"
            >
              {m.storage_operations_active()}
            </p>
            <ul class="flex flex-col gap-2">
              {#each activeOps as op (op.id)}
                {@const TypeIcon = typeIconMap[op.type]}
                <li role="none" class="bg-base-200 rounded-lg px-3 py-2.5">
                  <!-- Collapsible header row -->
                  <div class="flex items-center gap-2">
                    <div
                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                      role="button"
                      tabindex="0"
                      onclick={() => toggleExpand(op.id)}
                      onkeydown={(e) => e.key === 'Enter' && toggleExpand(op.id)}
                      aria-expanded={expandedOps[op.id]}
                    >
                      <!-- Chevron -->
                      <span
                        class="text-base-content/30 shrink-0 transition-transform duration-200"
                        class:rotate-90={expandedOps[op.id]}
                        aria-hidden="true"
                      >
                        <IconChevronRight class="size-3" />
                      </span>

                      <!-- Type icon -->
                      <span class="text-primary shrink-0" aria-hidden="true">
                        <TypeIcon class="size-3.5" />
                      </span>

                      <!-- Label -->
                      <span
                        class="text-base-content min-w-0 flex-1 truncate text-xs leading-tight font-medium"
                      >
                        {op.label}
                      </span>

                      <!-- Speed + ETA (collapsed, right-aligned) -->
                      {#if op.totalBytes > 0}
                        <span class="text-base-content/40 shrink-0 text-[9px] tabular-nums">
                          {speedEtaLabel(op)}
                        </span>
                      {/if}
                    </div>

                    <!-- Cancel -->
                    <div class="tooltip tooltip-left" data-tip={m.storage_operations_cancel()}>
                      <button
                        class="btn btn-ghost btn-xs text-error/70 hover:text-error size-5 shrink-0 p-0"
                        aria-label={m.storage_operations_cancel()}
                        onclick={() => storage.cancelOp(op.id)}
                      >
                        <IconClose class="size-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <!-- Expanded detail -->
                  {#if expandedOps[op.id]}
                    <div class="mt-2 space-y-1.5">
                      <!-- Current file -->
                      {#if op.currentFileName}
                        <div class="text-base-content/50 truncate pl-5 text-[11px]">
                          {op.currentFileName}
                        </div>
                      {/if}

                      <!-- Progress bar -->
                      {#if op.totalBytes > 0 || op.itemCount > 1}
                        <div
                          class="pl-5"
                          role="progressbar"
                          aria-valuenow={displayBytes(op)}
                          aria-valuemin={0}
                          aria-valuemax={op.totalBytes}
                          aria-label={op.label}
                        >
                          <div class="mb-1 flex items-center justify-between">
                            <span class="text-base-content/50 text-[10px] tabular-nums">
                              {op.phase === 'compressing'
                                ? m.storage_operations_compressing()
                                : progressLabel(op)}
                            </span>
                            <span class="text-primary text-[10px] font-semibold tabular-nums">
                              {#if op.phase === 'compressing'}
                                <span class="loading loading-spinner loading-xs" aria-hidden="true"
                                ></span>
                              {:else if op.totalBytes > 0}
                                {percent(op)}%
                              {:else}
                                {op.completedCount}/{op.itemCount}
                              {/if}
                            </span>
                          </div>
                          <div class="bg-base-300 h-1.5 w-full overflow-hidden rounded-full">
                            <div
                              class="bg-primary h-full rounded-full"
                              class:animate-pulse={op.phase === 'compressing'}
                              style="width: {op.phase === 'compressing' ? 100 : percent(op)}%"
                            ></div>
                          </div>
                        </div>
                      {/if}

                      <!-- File list -->
                      {#if op.sourceNames && op.sourceNames.length > 0}
                        <div class="mt-1.5 space-y-0.5 pl-5">
                          {#each op.sourceNames as name, i (i)}
                            <div class="flex items-center gap-1.5 text-[10px] tabular-nums">
                              {#if name === op.currentFileName}
                                <span
                                  class="loading loading-spinner loading-xs text-primary"
                                  aria-hidden="true"
                                ></span>
                              {:else if i < op.completedCount}
                                <span
                                  class="text-success inline-block size-2 rounded-full bg-current"
                                  aria-hidden="true"
                                ></span>
                              {:else}
                                <span
                                  class="text-base-content/20 inline-block size-2 rounded-full border border-current"
                                  aria-hidden="true"
                                ></span>
                              {/if}
                              <span class="text-base-content/70 truncate">{name}</span>
                            </div>
                          {/each}
                        </div>
                      {/if}

                      <!-- Elapsed time -->
                      <div class="text-base-content/35 mt-1.5 pl-5 text-[10px] tabular-nums">
                        {formatElapsed(op.startedAt, op.completedAt)}
                      </div>
                    </div>
                  {:else}
                    <!-- Collapsed: current file name on single line -->
                    {#if op.currentFileName}
                      <div class="text-base-content/40 mt-1 truncate pl-5 text-[10px]">
                        {op.currentFileName}
                      </div>
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- History section -->
        {#if hasHistory}
          <div class="px-3 pt-2.5 pb-2">
            <div class="mb-2 flex items-center justify-between">
              <p class="text-base-content/50 text-[10px] font-semibold tracking-widest uppercase">
                {m.storage_operations_history()}
              </p>
              <button
                class="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content flex h-5 items-center gap-1 px-1 py-0 text-[10px]"
                onclick={() => storage.clearOperationHistory()}
                aria-label={m.storage_operations_clear_history()}
              >
                <IconDeleteSweep class="size-3" aria-hidden="true" />
                {m.storage_operations_clear_history()}
              </button>
            </div>
            <ul class="flex flex-col gap-1">
              {#each historyOps as op (op.id)}
                {@const TypeIcon = typeIconMap[op.type]}
                <li role="none" class="rounded-md px-2.5 py-2 {statusBgColor(op)}">
                  <div class="flex items-center gap-2">
                    <!-- Status icon -->
                    <span class="shrink-0 {statusColor(op)}" aria-hidden="true">
                      {#if op.status === 'done'}
                        <IconCheckCircle class="size-3.5" />
                      {:else if op.status === 'error'}
                        <IconError class="size-3.5" />
                      {:else if op.status === 'cancelled'}
                        <IconCancel class="size-3.5" />
                      {:else}
                        <IconPowerOff class="size-3.5" />
                      {/if}
                    </span>
                    <!-- Operation type icon -->
                    <span class="text-base-content/50 shrink-0" aria-hidden="true">
                      <TypeIcon class="size-3" />
                    </span>
                    <span class="text-base-content/80 min-w-0 flex-1 truncate text-[11px]">
                      {op.label}
                    </span>
                    <div class="flex shrink-0 flex-col items-end gap-0.5">
                      <span class="text-[10px] font-medium {statusColor(op)}">
                        {statusLabel(op)}
                      </span>
                      <span class="text-base-content/35 text-[9px] tabular-nums">
                        {formatElapsed(op.startedAt, op.completedAt)}
                      </span>
                    </div>
                  </div>

                  <!-- Error detail -->
                  {#if op.status === 'error' && op.errorMessage}
                    <div
                      class="text-error/70 mt-1 truncate pl-5 text-[10px]"
                      title={op.errorMessage}
                    >
                      {op.errorMessage}
                    </div>
                  {:else if op.status === 'interrupted'}
                    <div class="text-warning/60 mt-1 pl-5 text-[10px]">
                      {m.storage_operations_interrupted_tooltip()}
                    </div>
                  {/if}

                  {#if op.type === 'download' && op.status === 'done' && downloadIsCached(op)}
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs text-primary mt-1 ml-5 h-6 px-1 text-[10px]"
                      onclick={() => storage.downloadAgain(op.id)}
                    >
                      <IconDownload class="size-3" aria-hidden="true" />
                      {m.storage_download_again()}
                    </button>
                  {/if}

                  <!-- Partial progress for interrupted / error -->
                  {#if (op.status === 'interrupted' || op.status === 'error') && op.totalBytes > 0}
                    <div class="mt-1.5 pl-5">
                      <div class="bg-base-300 h-1 w-full overflow-hidden rounded-full">
                        <div
                          class="h-full rounded-full {op.status === 'interrupted'
                            ? 'bg-warning'
                            : 'bg-error'}"
                          style="width: {percent(op)}%"
                        ></div>
                      </div>
                      <span class="text-base-content/35 text-[9px] tabular-nums">
                        {formatBytes(op.completedBytes)} / {formatBytes(op.totalBytes)}
                      </span>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {:else if activeOps.length === 0}
          <div class="text-base-content/40 flex items-center gap-2 px-4 py-3">
            <IconHistory class="size-4" aria-hidden="true" />
            <span class="text-xs">{m.storage_operations_history()}</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
