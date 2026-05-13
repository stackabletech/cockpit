<script lang="ts">
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import {
    pinnedLocations,
    unpinLocation,
    pinnedLabel,
    pinnedHref,
    type PinnedLocation
  } from '$lib/stores/pinned-locations.svelte.js';

  interface Props {
    buckets: string[];
  }

  let { buckets }: Props = $props();

  const activeBucket = $derived(page.params.bucket ?? null);
  const activePrefix = $derived(page.params.prefix ? page.params.prefix + '/' : '');

  function isPinnedActive(pin: PinnedLocation): boolean {
    return page.params.bucket === pin.bucket && activePrefix === pin.prefix;
  }

  // ── Unpin context menu ────────────────────────────────────────────────────
  let unpinCtx = $state<{
    x: number;
    y: number;
    bucket: string;
    prefix: string;
  } | null>(null);

  function openUnpinMenu(e: MouseEvent, pin: PinnedLocation) {
    e.preventDefault();
    e.stopPropagation();
    unpinCtx = { x: e.clientX, y: e.clientY, bucket: pin.bucket, prefix: pin.prefix };
  }

  function closeUnpinMenu() {
    unpinCtx = null;
  }

  function handleUnpin() {
    if (unpinCtx) {
      unpinLocation(unpinCtx.bucket, unpinCtx.prefix);
      closeUnpinMenu();
    }
  }
</script>

{#if unpinCtx}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onmousedown={closeUnpinMenu}
    onkeydown={(e) => e.key === 'Escape' && closeUnpinMenu()}
  ></div>
  <ul
    class="
      menu menu-sm border-base-300 bg-base-100 fixed z-50 w-40 rounded-lg
      border p-1 shadow-lg
    "
    role="menu"
    style="left: {unpinCtx.x}px; top: {unpinCtx.y}px;"
  >
    <li role="none">
      <button role="menuitem" class="text-error justify-start" onclick={handleUnpin}>
        <Icon icon="material-symbols:push-pin-outline" class="size-4 shrink-0" aria-hidden="true" />
        {m.storage_action_unpin()}
      </button>
    </li>
  </ul>
{/if}

<nav
  class="
    border-base-300 bg-base-100 flex w-48 shrink-0 flex-col overflow-hidden
    rounded-lg border
  "
  aria-label={m.storage_buckets_label()}
>
  <!-- Pinned Access section -->
  {#if pinnedLocations.length > 0}
    <div class="border-base-300 border-b">
      <div class="flex items-center px-3 py-2">
        <span class="text-base-content/50 text-xs font-semibold tracking-wide uppercase">
          {m.storage_pinned_label()}
        </span>
      </div>
      <ul class="py-1" role="list">
        {#each pinnedLocations as pin (pin.bucket + '::' + pin.prefix)}
          {@const active = isPinnedActive(pin)}
          <li role="none">
            <a
              href={pinnedHref(pin)}
              data-sveltekit-preload-data="off"
              class="
                hover:bg-base-200 flex items-center gap-2 px-3 py-1.5
                text-sm
                {active ? 'bg-primary/10 text-primary font-medium' : 'text-base-content'}"
              aria-current={active ? 'page' : undefined}
              oncontextmenu={(e) => openUnpinMenu(e, pin)}
            >
              {#if pin.prefix === ''}
                <Icon
                  icon="mdi:bucket-outline"
                  class="size-3.5 shrink-0 opacity-60"
                  aria-hidden="true"
                />
              {:else}
                <Icon
                  icon="material-symbols:folder-outline"
                  class="size-3.5 shrink-0 opacity-60"
                  aria-hidden="true"
                />
              {/if}
              <span class="truncate">{pinnedLabel(pin)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div
    class="
      border-base-300 flex items-center justify-between border-b px-3 py-2
    "
  >
    <span
      class="
        text-base-content/50 text-xs font-semibold tracking-wide uppercase
      "
    >
      {m.storage_buckets_label()}
    </span>
    <a
      href="/storage"
      data-sveltekit-preload-data="off"
      class="btn btn-ghost btn-xs"
      title={m.storage_view_all_buckets()}
      aria-label={m.storage_view_all_buckets()}
    >
      <Icon icon="material-symbols:grid-view" class="size-3.5" aria-hidden="true" />
    </a>
  </div>

  <ul class="flex-1 overflow-y-auto py-1" role="list">
    {#if buckets.length === 0}
      <li class="text-base-content/40 px-3 py-4 text-center text-xs">
        {m.storage_buckets_empty()}
      </li>
    {:else}
      {#each buckets as bucket (bucket)}
        <li role="none">
          <a
            href="/storage/{encodeURIComponent(bucket)}"
            data-sveltekit-preload-data="off"
            class="
              hover:bg-base-200 flex items-center gap-2 px-3 py-1.5
              text-sm
              {activeBucket === bucket
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-base-content'}"
            aria-current={activeBucket === bucket ? 'page' : undefined}
          >
            <Icon
              icon="mdi:bucket-outline"
              class="size-3.5 shrink-0 opacity-60"
              aria-hidden="true"
            />
            <span class="truncate">{bucket}</span>
          </a>
        </li>
      {/each}
    {/if}
  </ul>

  <!-- TODO: This needs to be a two step process to avoid unintentional disconnects from misclicks -->
  <!-- Disconnect button -->
  <div class="border-base-300 border-t p-2">
    <form method="POST" action="/storage?/disconnect">
      <button
        type="submit"
        class="
        btn text-base-content/60 btn-ghost btn-xs hover:text-error w-full
      "
      >
        {m.storage_disconnect()}
      </button>
    </form>
  </div>
</nav>
