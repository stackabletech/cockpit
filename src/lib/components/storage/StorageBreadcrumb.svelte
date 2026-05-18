<script lang="ts">
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    bucket: string;
    prefix: string;
    folderCount: number;
    fileCount: number;
    selectionMode: boolean;
    onNavigate: (prefix: string) => void;
    onToggleSelectionMode: () => void;
    onUpload: () => void;
  }

  let {
    bucket,
    prefix,
    folderCount,
    fileCount,
    selectionMode,
    onNavigate,
    onToggleSelectionMode,
    onUpload
  }: Props = $props();

  const breadcrumbParts = $derived(
    prefix
      ? prefix
          .slice(0, -1)
          .split('/')
          .map((label, i, parts) => ({
            label,
            prefix: parts.slice(0, i + 1).join('/') + '/'
          }))
      : []
  );

  const MAX_TAIL = 2;
  const collapsedParts = $derived(
    breadcrumbParts.length > MAX_TAIL ? breadcrumbParts.slice(0, -MAX_TAIL) : []
  );
  const visibleParts = $derived(
    breadcrumbParts.length > MAX_TAIL ? breadcrumbParts.slice(-MAX_TAIL) : breadcrumbParts
  );
</script>

<div class="border-base-300 flex items-center gap-3 border-b px-6 py-3">
  <!-- Breadcrumbs -->
  <nav
    aria-label="breadcrumb"
    class="
    flex min-w-0 flex-1 items-center gap-1 text-sm
  "
  >
    {#if breadcrumbParts.length === 0}
      <span
        class="
          text-base-content flex shrink-0 items-center gap-1.5 rounded-sm px-1.5
          py-0.5 font-medium
        "
        title={bucket}
        aria-current="page"
      >
        <Icon icon="material-symbols:storage" class="size-4" aria-hidden="true" />
        {bucket}
      </span>
    {:else}
      <button
        class="
          text-base-content/70 hover:bg-base-200 hover:text-base-content flex shrink-0 items-center gap-1.5
          rounded-sm px-1.5
          py-0.5 transition-colors hover:cursor-pointer
        "
        title={bucket}
        onclick={() => onNavigate('')}
      >
        <Icon icon="material-symbols:storage" class="size-4" aria-hidden="true" />
        {bucket}
      </button>
    {/if}
    {#if collapsedParts.length > 0}
      <Icon
        icon="material-symbols:chevron-right"
        class="text-base-content/30 size-4 shrink-0"
        aria-hidden="true"
      />
      <div class="dropdown">
        <button
          tabindex="0"
          class="
            hover:bg-base-200 hover:text-base-content flex items-center rounded-sm px-1.5
            py-0.5 transition-colors hover:cursor-pointer
            focus-visible:outline
          "
          aria-label={m.storage_breadcrumb_more()}
          aria-haspopup="listbox"
        >
          <Icon icon="material-symbols:more-horiz" class="size-4" aria-hidden="true" />
        </button>
        <ul
          tabindex="0"
          role="listbox"
          aria-label={m.storage_breadcrumb_more()}
          class="
            dropdown-content menu rounded-box border-base-300 bg-base-100 z-50 w-48
            border p-1 shadow-lg
          "
        >
          {#each collapsedParts as part (part.prefix)}
            <li>
              <button
                class="
                  text-sm
                  hover:cursor-pointer
                "
                onclick={() => onNavigate(part.prefix)}
              >
                {part.label}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#each visibleParts as part, i (part.prefix)}
      {@const isCurrent = i === visibleParts.length - 1}
      <Icon
        icon="material-symbols:chevron-right"
        class="text-base-content/30 size-4 shrink-0"
        aria-hidden="true"
      />
      {#if isCurrent}
        <span
          class="
            text-base-content min-w-0 truncate rounded-sm px-1.5 py-0.5
            font-medium
          "
          title={part.label}
          aria-current="page"
        >
          {part.label}
        </span>
      {:else}
        <button
          class="
            hover:bg-base-200 hover:text-base-content min-w-0 truncate rounded-sm px-1.5
            py-0.5 transition-colors hover:cursor-pointer
          "
          title={part.label}
          onclick={() => onNavigate(part.prefix)}
        >
          {part.label}
        </button>
      {/if}
    {/each}
  </nav>

  <!-- Item count badge -->
  <span class="text-base-content/40 shrink-0 text-xs">
    {folderCount}
    {folderCount === 1 ? m.storage_folder() : m.storage_folders()},
    {fileCount}
    {fileCount === 1 ? m.storage_file() : m.storage_files()}
  </span>

  <!-- Multi-select toggle -->
  <button
    class={'btn btn-ghost btn-xs gap-1 ' + (selectionMode ? 'bg-success/20 text-success' : '')}
    title={m.storage_select_toggle()}
    aria-pressed={selectionMode}
    onclick={onToggleSelectionMode}
  >
    <span class={'swap swap-rotate ' + (selectionMode ? 'swap-active' : '')} aria-hidden="true">
      <Icon icon="material-symbols:check-box" class="swap-on size-3.5" />
      <Icon icon="material-symbols:check-box-outline-blank" class="swap-off size-3.5" />
    </span>
    {m.storage_select_toggle()}
  </button>

  <!-- Upload button -->
  <button class="btn btn-primary btn-xs gap-1" onclick={onUpload}>
    <Icon icon="material-symbols:upload" class="size-3.5" aria-hidden="true" />
    {m.storage_action_upload()}
  </button>
</div>
