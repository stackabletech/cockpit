<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { navigating } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import { storageRestoreTabsEnabled } from '$lib/client/feature-flags.js';
  import { type PersistedTabsState } from '$lib/storage/tabs.svelte.js';
  import { LS_TABS } from '$lib/storage/persistence.js';
  import IconTabOutline from 'virtual:icons/material-symbols/tab-outline';
  import IconClose from 'virtual:icons/material-symbols/close';
  import BucketGrid from '$lib/components/storage/landing/BucketGrid.svelte';
  import StorageConnectForm from '$lib/components/storage/landing/StorageConnectForm.svelte';
  import RecentItems from '$lib/components/storage/landing/RecentItems.svelte';
  import AddBucketModal from '$lib/components/storage/landing/AddBucketModal.svelte';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import StorageSearch from '$lib/components/storage/StorageSearch.svelte';

  let { data } = $props();
  const storage = getStorageState();

  let addBucketOpen = $state(false);

  const connectError = $derived<string | null>(
    (page.form as { error?: string } | null)?.error ?? null
  );

  let savedTabs = $state<PersistedTabsState | null>(null);

  $effect(() => {
    if (!browser || !storageRestoreTabsEnabled) return;

    try {
      const raw = localStorage.getItem(LS_TABS);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedTabsState;
      if (!Array.isArray(parsed?.tabs) || parsed.tabs.length <= 1) return;
      if (
        parsed.connectionId &&
        storage.connectionId &&
        parsed.connectionId !== storage.connectionId
      )
        return;
      savedTabs = parsed;
    } catch {
      // ignore malformed data
    }
  });

  // ── Track whether the user explicitly clicked "Restore tabs" ──
  // When navigating from the landing page to a bucket, we need to know
  // if the restore button was clicked or if the user just clicked a bucket
  // directly. In the latter case, persisted tabs should be cleared so the
  // FileExplorer starts fresh rather than auto-restoring.
  let restoreClicked = $state(false);

  $effect(() => {
    if (!browser || !storageRestoreTabsEnabled) return;
    const to = navigating?.to?.url.pathname;
    if (!to || !to.startsWith('/storage/') || to === '/storage') return;
    // Navigation to a bucket sub-path is starting — if the user did not
    // explicitly click "Restore tabs", clear persisted tabs so that
    // ensureInitialTab creates a fresh single tab.
    if (!restoreClicked) {
      localStorage.removeItem(LS_TABS);
    }
  });

  function handleRestore() {
    if (!savedTabs) return;

    restoreClicked = true;

    const active = savedTabs.tabs.find((t) => t.id === savedTabs!.activeTabId) ?? savedTabs.tabs[0];
    const encodedPrefix = active.prefix
      ? active.prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';

    savedTabs = null;
    goto(
      resolve('/(app)/storage/browse/[connection]/[bucket]/[...prefix]', {
        connection: encodeURIComponent(storage.connectionHostname),
        bucket: encodeURIComponent(active.bucket),
        prefix: encodedPrefix
      })
    );
  }

  function handleDismiss() {
    savedTabs = null;
  }

  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
</script>

{#if data.connected && storage.connectionHostname}
  <div class="relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto p-2">
    {#if navigating?.to?.url.pathname.startsWith('/storage/')}
      <div
        class="bg-base-100/70 absolute inset-0 z-10 flex items-center justify-center rounded-xl"
        aria-live="polite"
        aria-label={m.storage_loading()}
      >
        <span class="loading loading-md loading-spinner text-primary" aria-hidden="true"></span>
      </div>
    {/if}
    {#if savedTabs}
      <div
        role="alert"
        class="alert alert-info mb-3 flex items-center gap-3 py-2.5 pr-2 pl-3 text-sm"
      >
        <IconTabOutline class="size-4 shrink-0" aria-hidden="true" />
        <span class="flex-1">
          {m.storage_restore_tabs_message({ count: savedTabs.tabs.length })}
        </span>
        <button class="btn btn-sm btn-neutral shrink-0" onclick={handleRestore}>
          {m.storage_restore_tabs_action()}
        </button>
        <div class="tooltip tooltip-bottom" data-tip={m.storage_download_dismiss()}>
          <button
            class="btn btn-ghost btn-sm btn-square shrink-0"
            aria-label={m.storage_download_dismiss()}
            onclick={handleDismiss}
          >
            <IconClose class="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    {/if}

    <div class="mb-6">
      <div class="mb-1 flex items-center justify-between gap-4">
        <h1 class="text-xl font-semibold">{m.storage_buckets_label()}</h1>
        <div class="flex shrink-0 items-center gap-1">
          <StorageSearch />
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onclick={() => (addBucketOpen = true)}
            aria-label={m.storage_add_bucket()}
          >
            <IconAdd class="size-4" aria-hidden="true" />
            {m.storage_add_bucket()}
          </button>
        </div>
      </div>
      <p class="text-base-content/60 text-sm">{m.storage_buckets_subtitle()}</p>
    </div>
    <BucketGrid buckets={storage.buckets} loading={data.hydrating || !storage.connectionHostname} />
  </div>
  <div class="relative flex h-full min-h-0 flex-col overflow-y-auto p-2">
    <RecentItems loading={data.hydrating} />
  </div>
  <AddBucketModal bind:open={addBucketOpen} />
{:else if data.connected || (data.hydrating && data.hasActiveConnection)}
  <div class="flex h-full items-center justify-center">
    <span class="loading loading-lg loading-spinner text-primary" aria-hidden="true"></span>
  </div>
{:else if mounted}
  <StorageConnectForm
    connectionForm={data.connectionForm}
    connections={data.connections ?? []}
    {connectError}
  />
{/if}
