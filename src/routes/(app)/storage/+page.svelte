<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { navigating } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import { storageRestoreTabsEnabled } from '$lib/client/feature-flags.js';
  import { requestTabsRestore, type PersistedTabsState } from '$lib/storage/tabs.svelte.js';
  import { LS_TABS } from '$lib/storage/persistence.js';
  import IconTabOutline from 'virtual:icons/material-symbols/tab-outline';
  import IconClose from 'virtual:icons/material-symbols/close';
  import BucketGrid from '$lib/components/storage/landing/BucketGrid.svelte';
  import StorageConnectForm from '$lib/components/storage/landing/StorageConnectForm.svelte';
  import RecentItems from '$lib/components/storage/landing/RecentItems.svelte';

  let { data } = $props();
  const storage = getStorageState();

  // ── Restore-tabs banner ───────────────────────────────────────────────────

  let savedTabs = $state<PersistedTabsState | null>(null);

  $effect(() => {
    if (!browser || !storageRestoreTabsEnabled) return;

    try {
      const raw = localStorage.getItem(LS_TABS);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedTabsState;
      if (!Array.isArray(parsed?.tabs) || parsed.tabs.length <= 1) return;
      // If the saved data carries a connectionId that differs from the current
      // connection, do not offer restore (tabs are from a different connection).
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

  function handleRestore() {
    if (!savedTabs) return;

    requestTabsRestore();

    const active = savedTabs.tabs.find((t) => t.id === savedTabs!.activeTabId) ?? savedTabs.tabs[0];
    const encodedPrefix = active.prefix
      ? active.prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';

    savedTabs = null;
    goto(
      resolve('/(app)/storage/[bucket]/[...prefix]', {
        bucket: encodeURIComponent(active.bucket),
        prefix: encodedPrefix
      })
    );
  }

  function handleDismiss() {
    savedTabs = null;
  }
</script>

{#if data.connected}
  <div class="relative flex h-full min-h-0 flex-col overflow-hidden p-2">
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
        <button
          class="btn btn-ghost btn-sm btn-square shrink-0"
          aria-label={m.storage_download_dismiss()}
          onclick={handleDismiss}
        >
          <IconClose class="size-4" aria-hidden="true" />
        </button>
      </div>
    {/if}

    <h1 class="mb-1 text-xl font-semibold">{m.storage_buckets_label()}</h1>

    <p class="text-base-content/60 mb-6 text-sm">{m.storage_buckets_subtitle()}</p>
    <BucketGrid buckets={storage.buckets} />
    <RecentItems />
  </div>
{:else}
  <StorageConnectForm connectionForm={data.connectionForm} />
{/if}
