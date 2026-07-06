<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { StorageOperation } from '$lib/storage/types.js';

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

  function statusClass(op: StorageOperation): string {
    if (op.status === 'running') return 'text-primary';
    if (op.status === 'done') return 'text-success';
    if (op.status === 'cancelled') return 'text-base-content/50';
    return 'text-error';
  }

  function statusLabel(op: StorageOperation): string {
    if (op.status === 'running') return '…';
    if (op.status === 'done') return m.storage_operation_done();
    if (op.status === 'cancelled') return m.storage_operation_cancelled();
    return op.errorMessage ?? m.storage_operation_failed();
  }

  function typeIcon(op: StorageOperation): string {
    switch (op.type) {
      case 'paste':
        return '📋';
      case 'move':
        return '📦';
      case 'rename':
        return '✏️';
      case 'delete':
        return '🗑️';
      default:
        return '⚙️';
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
      return `${op.completedCount}/${op.itemCount}`;
    }
    return '';
  }
</script>

{#if storage.operations.length > 0}
  <div class="dropdown dropdown-end inline-flex" class:dropdown-open={dropdownOpen}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#if dropdownOpen}
      <div
        class="fixed inset-0 z-40"
        onmousedown={closeDropdown}
        onkeydown={(e) => e.key === 'Escape' && closeDropdown()}
      ></div>
    {/if}
    <button
      class="
        btn btn-ghost btn-xs relative size-7 rounded-full p-0
        {storage.hasRunningOps
        ? 'text-primary'
        : storage.operations.some((o) => o.status === 'error')
          ? 'text-error'
          : 'text-success'}
      "
      title={m.storage_operations_label()}
      aria-label={m.storage_operations_label()}
      aria-expanded={dropdownOpen}
      aria-haspopup="menu"
      onclick={toggleDropdown}
    >
      {#if storage.hasRunningOps}
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
      {:else if storage.operations.some((o) => o.status === 'error')}
        <svg
          class="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      {:else}
        <svg
          class="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      {/if}
    </button>

    <ul
      role="menu"
      aria-label={m.storage_operations_label()}
      class="
        dropdown-content rounded-box border-base-300 bg-base-100 z-60 min-w-72
        border p-1 shadow-lg
      "
    >
      {#each storage.operations as op (op.id)}
        <li role="none" class="flex flex-col gap-1 px-3 py-2 text-sm">
          <!-- Row 1: icon + label + status -->
          <div class="flex items-center gap-2">
            <span class="shrink-0 text-xs" aria-hidden="true">{typeIcon(op)}</span>
            <span class="min-w-0 flex-1 truncate font-medium">{op.label}</span>
            <span class="shrink-0 text-xs font-medium {statusClass(op)}">
              {#if op.status === 'running'}
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {:else}
                {statusLabel(op)}
              {/if}
            </span>
          </div>

          <!-- Row 2: current file name (while running) -->
          {#if op.currentFileName && op.status === 'running'}
            <div class="text-base-content/60 truncate pl-5 text-[11px]">
              {op.currentFileName}
            </div>
          {/if}

          <!-- Row 3: destination path -->
          {#if op.destPath}
            <div class="text-base-content/40 truncate pl-5 text-[11px]" title={op.destPath}>
              → {op.destPath}
            </div>
          {/if}

          <!-- Row 4: progress bar (running, has bytes to track or multiple items) -->
          {#if op.status === 'running' && (op.totalBytes > 0 || op.itemCount > 1)}
            <div class="flex items-center gap-2 pl-5">
              <progress
                class="progress progress-primary h-1.5 flex-1"
                value={op.totalBytes > 0 ? op.completedBytes : op.completedCount}
                max={op.totalBytes > 0 ? op.totalBytes : op.itemCount}
                aria-valuenow={op.totalBytes > 0 ? op.completedBytes : op.completedCount}
                aria-valuemin={0}
                aria-valuemax={op.totalBytes > 0 ? op.totalBytes : op.itemCount}
                aria-label={op.label}
              ></progress>
              <span class="text-base-content/50 text-[10px] tabular-nums">
                {#if op.totalBytes > 0}
                  {percent(op)}%
                {:else}
                  {op.completedCount}/{op.itemCount}
                {/if}
              </span>
            </div>
            {#if op.totalBytes > 0}
              <div class="text-base-content/40 pl-5 text-[10px]">
                {progressLabel(op)}
              </div>
            {/if}
          {/if}

          <!-- Row 5: error message -->
          {#if op.status === 'error' && op.errorMessage}
            <div
              class="text-error/80 truncate pl-5 text-[11px] leading-tight"
              title={op.errorMessage}
            >
              {op.errorMessage}
            </div>
          {/if}

          <!-- Row 6: elapsed time + cancel button -->
          <div class="flex items-center justify-between pl-5">
            <span class="text-base-content/40 text-[10px] tabular-nums">
              {formatElapsed(op.startedAt, op.completedAt)}
            </span>
            {#if op.status === 'running'}
              <button
                class="btn btn-ghost btn-xs text-error size-5 p-0"
                title={m.storage_operations_cancel()}
                aria-label={m.storage_operations_cancel()}
                onclick={() => storage.cancelOp(op.id)}
              >
                <svg
                  class="size-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}
