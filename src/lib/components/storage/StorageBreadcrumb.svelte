<script lang="ts">
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { pinLocation, unpinLocation, isPinned } from '$lib/stores/pinned-locations.svelte.js';

  interface Props {
    bucket: string;
    prefix: string;
    folderCount: number;
    fileCount: number;
    selectionMode: boolean;
    onNavigate: (prefix: string) => void;
    onToggleSelectionMode: () => void;
  }

  let {
    bucket,
    prefix,
    folderCount,
    fileCount,
    selectionMode,
    onNavigate,
    onToggleSelectionMode
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

  const currentIsPinned = $derived(isPinned(bucket, prefix));

  // ── Breadcrumb label context menu (right-click to pin) ────────────────────
  let breadcrumbCtx = $state<{
    x: number;
    y: number;
    pinnedBucket: string;
    pinnedPrefix: string;
  } | null>(null);

  function openBreadcrumbCtx(e: MouseEvent, b: string, p: string) {
    e.preventDefault();
    breadcrumbCtx = { x: e.clientX, y: e.clientY, pinnedBucket: b, pinnedPrefix: p };
  }

  function closeBreadcrumbCtx() {
    breadcrumbCtx = null;
  }

  function handleBreadcrumbPin() {
    if (breadcrumbCtx) {
      const alreadyPinned = isPinned(breadcrumbCtx.pinnedBucket, breadcrumbCtx.pinnedPrefix);
      if (alreadyPinned) {
        unpinLocation(breadcrumbCtx.pinnedBucket, breadcrumbCtx.pinnedPrefix);
      } else {
        pinLocation(breadcrumbCtx.pinnedBucket, breadcrumbCtx.pinnedPrefix);
      }
      closeBreadcrumbCtx();
    }
  }
</script>

{#if breadcrumbCtx}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onmousedown={closeBreadcrumbCtx}
    onkeydown={(e) => e.key === 'Escape' && closeBreadcrumbCtx()}
  ></div>
  <ul
    class="
      menu menu-sm border-base-300 bg-base-100 fixed z-50 w-48 rounded-lg
      border p-1 shadow-lg
    "
    role="menu"
    style="left: {breadcrumbCtx.x}px; top: {breadcrumbCtx.y}px;"
  >
    {#if isPinned(breadcrumbCtx.pinnedBucket, breadcrumbCtx.pinnedPrefix)}
      <li role="none">
        <button role="menuitem" class="justify-start" onclick={handleBreadcrumbPin}>
          <Icon icon="material-symbols:push-pin" class="size-4 shrink-0" aria-hidden="true" />
          {m.storage_action_unpin()}
        </button>
      </li>
    {:else}
      <li role="none">
        <button role="menuitem" class="justify-start" onclick={handleBreadcrumbPin}>
          <Icon
            icon="material-symbols:push-pin-outline"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          {m.storage_action_pin()}
        </button>
      </li>
    {/if}
  </ul>
{/if}

<div class="border-base-300 flex items-center gap-3 border-b px-6 py-3">
  <!-- Breadcrumbs -->
  <nav
    aria-label="breadcrumb"
    class="
    flex min-w-0 flex-1 items-center gap-1 text-sm
  "
  >
    {#if breadcrumbParts.length === 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="
          text-base-content flex shrink-0 items-center gap-1.5 rounded-sm px-1.5
          py-0.5 font-medium
        "
        title={bucket}
        aria-current="page"
        oncontextmenu={(e) => openBreadcrumbCtx(e, bucket, '')}
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
        oncontextmenu={(e) => openBreadcrumbCtx(e, bucket, '')}
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
                oncontextmenu={(e) => openBreadcrumbCtx(e, bucket, part.prefix)}
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
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="
            text-base-content min-w-0 truncate rounded-sm px-1.5 py-0.5
            font-medium
          "
          title={part.label}
          aria-current="page"
          oncontextmenu={(e) => openBreadcrumbCtx(e, bucket, part.prefix)}
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
          oncontextmenu={(e) => openBreadcrumbCtx(e, bucket, part.prefix)}
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

  <!-- More options (pin current location) -->
  <div class="dropdown dropdown-end">
    <button
      tabindex="0"
      class="btn btn-ghost btn-xs"
      title={m.storage_more_options()}
      aria-label={m.storage_more_options()}
      aria-haspopup="menu"
    >
      <Icon icon="material-symbols:more-vert" class="size-3.5" aria-hidden="true" />
    </button>
    <ul
      tabindex="0"
      role="menu"
      class="
        dropdown-content menu rounded-box border-base-300 bg-base-100 z-50 w-52
        border p-1 shadow-lg
      "
    >
      <li role="none">
        <button
          role="menuitem"
          class="justify-start text-sm"
          onclick={() => {
            if (currentIsPinned) {
              unpinLocation(bucket, prefix);
            } else {
              pinLocation(bucket, prefix);
            }
          }}
        >
          <Icon
            icon={currentIsPinned
              ? 'material-symbols:push-pin'
              : 'material-symbols:push-pin-outline'}
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          {currentIsPinned ? m.storage_action_unpin() : m.storage_action_pin()}
        </button>
      </li>
    </ul>
  </div>
</div>
