<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { StorageOperation } from '$lib/storage/types.js';

  const storage = getStorageState();

  let dropdownOpen = $state(false);

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
  }

  function closeDropdown() {
    dropdownOpen = false;
  }

  function statusClass(op: StorageOperation): string {
    if (op.status === 'running') return 'text-primary';
    if (op.status === 'done') return 'text-success';
    return 'text-error';
  }

  function statusLabel(op: StorageOperation): string {
    if (op.status === 'running') return '…';
    if (op.status === 'done') return m.storage_operation_done();
    return m.storage_operation_failed();
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
        <!-- ✗ icon -->
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
        <!-- ✓ icon -->
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
        dropdown-content rounded-box border-base-300 bg-base-100 z-60 min-w-52
        border p-1 shadow-lg
      "
    >
      {#each storage.operations as op (op.id)}
        <li role="none" class="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span class="min-w-0 flex-1 truncate">{op.label}</span>
          <span class="shrink-0 text-xs font-medium {statusClass(op)}">
            {#if op.status === 'running'}
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            {:else}
              {statusLabel(op)}
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </div>
{/if}
