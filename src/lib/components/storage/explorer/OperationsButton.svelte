<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { StorageOperation } from '$lib/storage/types.js';
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

  const storage = getStorageState();

  let dropdownOpen = $state(false);
  // Ticks every second so the elapsed timer updates reactively.
  let tick = $state(0);

  $effect(() => {
    if (!storage.hasRunningOps) return;
    const id = setInterval(() => {
      tick++;
    }, 1000);
    return () => clearInterval(id);
  });

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
  }

  function closeDropdown() {
    dropdownOpen = false;
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

  function percent(op: StorageOperation): number {
    if (op.totalBytes <= 0) return 0;
    return Math.min(100, Math.round((op.completedBytes / op.totalBytes) * 100));
  }

  function progressLabel(op: StorageOperation): string {
    if (op.totalBytes > 0) {
      return `${formatBytes(op.completedBytes)} / ${formatBytes(op.totalBytes)}`;
    }
    if (op.itemCount > 1) {
      return `${op.completedCount} / ${op.itemCount}`;
    }
    return '';
  }
</script>

{#if storage.operations.length > 0}
  <div class="dropdown dropdown-end inline-flex" class:dropdown-open={dropdownOpen}>
    <!-- Backdrop to close dropdown -->
    {#if dropdownOpen}
      <div
        class="fixed inset-0 z-40"
        onmousedown={closeDropdown}
        onkeydown={(e) => e.key === 'Escape' && closeDropdown()}
        role="presentation"
      ></div>
    {/if}

    <!-- Trigger button -->
    <button
      class="
        btn btn-ghost btn-xs relative size-7 rounded-full p-0
        {storage.hasRunningOps ? 'text-primary' : hasError ? 'text-error' : 'text-success'}
      "
      title={m.storage_operations_label()}
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

    <!-- Dropdown panel -->
    <div
      role="menu"
      aria-label={m.storage_operations_label()}
      class="dropdown-content rounded-box border-base-300 bg-base-100 z-60 w-80 border shadow-xl"
    >
      <!-- Active operations section -->
      {#if activeOps.length > 0}
        <div class="border-base-300 border-b px-3 pt-3 pb-2">
          <p class="text-base-content/50 mb-2 text-[10px] font-semibold tracking-widest uppercase">
            {m.storage_operations_active()}
          </p>
          <ul class="flex flex-col gap-2">
            {#each activeOps as op (op.id)}
              <li role="none" class="bg-base-200 rounded-lg px-3 py-2.5">
                <!-- Row 1: type icon + label + cancel -->
                <div class="flex items-start gap-2">
                  <span class="text-primary mt-0.5 shrink-0" aria-hidden="true">
                    {#if op.type === 'paste'}
                      <IconContentPaste class="size-3.5" />
                    {:else if op.type === 'move'}
                      <IconDriveFileMove class="size-3.5" />
                    {:else if op.type === 'rename'}
                      <IconEdit class="size-3.5" />
                    {:else}
                      <IconDelete class="size-3.5" />
                    {/if}
                  </span>
                  <span
                    class="text-base-content min-w-0 flex-1 truncate text-xs leading-tight font-medium"
                  >
                    {op.label}
                  </span>
                  <button
                    class="btn btn-ghost btn-xs text-error/70 hover:text-error size-5 shrink-0 p-0"
                    title={m.storage_operations_cancel()}
                    aria-label={m.storage_operations_cancel()}
                    onclick={() => storage.cancelOp(op.id)}
                  >
                    <IconClose class="size-3" aria-hidden="true" />
                  </button>
                </div>

                <!-- Current file name -->
                {#if op.currentFileName}
                  <div class="text-base-content/50 mt-1.5 truncate pl-5 text-[11px]">
                    {op.currentFileName}
                  </div>
                {/if}

                <!-- Progress bar + stats -->
                {#if op.totalBytes > 0 || op.itemCount > 1}
                  <div class="mt-2 pl-5">
                    <div class="mb-1 flex items-center justify-between">
                      <span class="text-base-content/50 text-[10px] tabular-nums">
                        {progressLabel(op)}
                      </span>
                      <span class="text-primary text-[10px] font-semibold tabular-nums">
                        {#if op.totalBytes > 0}
                          {percent(op)}%
                        {:else}
                          {op.completedCount}/{op.itemCount}
                        {/if}
                      </span>
                    </div>
                    <progress
                      class="progress progress-primary progress-smooth h-1.5 w-full"
                      value={op.totalBytes > 0 ? op.completedBytes : op.completedCount}
                      max={op.totalBytes > 0 ? op.totalBytes : op.itemCount}
                      aria-valuenow={op.totalBytes > 0 ? op.completedBytes : op.completedCount}
                      aria-valuemin={0}
                      aria-valuemax={op.totalBytes > 0 ? op.totalBytes : op.itemCount}
                      aria-label={op.label}
                    ></progress>
                  </div>
                {/if}

                <!-- Elapsed time -->
                <div class="text-base-content/35 mt-1.5 pl-5 text-[10px] tabular-nums">
                  {formatElapsed(op.startedAt, op.completedAt)}
                </div>
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
                    {#if op.type === 'paste'}
                      <IconContentPaste class="size-3" />
                    {:else if op.type === 'move'}
                      <IconDriveFileMove class="size-3" />
                    {:else if op.type === 'rename'}
                      <IconEdit class="size-3" />
                    {:else}
                      <IconDelete class="size-3" />
                    {/if}
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
                  <div class="text-error/70 mt-1 truncate pl-5 text-[10px]" title={op.errorMessage}>
                    {op.errorMessage}
                  </div>
                {:else if op.status === 'interrupted'}
                  <div class="text-warning/60 mt-1 pl-5 text-[10px]">
                    {m.storage_operations_interrupted_tooltip()}
                  </div>
                {/if}

                <!-- Partial progress for interrupted / error -->
                {#if (op.status === 'interrupted' || op.status === 'error') && op.totalBytes > 0}
                  <div class="mt-1.5 pl-5">
                    <progress
                      class="progress h-1 w-full {op.status === 'interrupted'
                        ? 'progress-warning'
                        : 'progress-error'}"
                      value={op.completedBytes}
                      max={op.totalBytes}
                      aria-label={op.label}
                    ></progress>
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
  </div>
{/if}
