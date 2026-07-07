<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import IconBucket from '$lib/components/storage/shared/BucketIcon.svelte';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
  import type { BucketDetails as BucketDetailsType } from '$lib/storage/details-types.js';

  interface Props {
    bucket: string;
  }

  let { bucket }: Props = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let details = $state<BucketDetailsType | null>(null);

  $effect(() => {
    loading = true;
    error = null;

    async function fetchDetails() {
      try {
        const conn = loadConnectionLocally();
        if (!conn) {
          error = 'No storage connection configured';
          loading = false;
          return;
        }
        const connHeader = getConnectionHeader(conn);
        const params = new URLSearchParams({ bucket });
        const res = await fetch(`/api/storage/bucket-details?${params}`, {
          headers: { 'x-storage-connection': connHeader }
        });
        if (!res.ok) {
          error = `Failed to fetch bucket details (${res.status})`;
          loading = false;
          return;
        }
        details = (await res.json()) as BucketDetailsType;
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
      } finally {
        loading = false;
      }
    }

    void fetchDetails();
  });

  function versioningLabel(status: boolean): string {
    return status
      ? m.storage_details_versioning_enabled()
      : m.storage_details_versioning_disabled();
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center gap-3">
    <IconBucket class="text-warning size-8 shrink-0" aria-hidden="true" />
    <div class="min-w-0">
      <p class="truncate font-medium">{bucket}</p>
    </div>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-8">
      <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
    </div>
  {/if}

  {#if error}
    <div
      class="border-error/40 bg-error/10 flex items-center gap-3 rounded-lg border p-4"
      role="alert"
    >
      <IconWarning class="text-error size-5 shrink-0" aria-hidden="true" />
      <p class="text-sm">{error}</p>
    </div>
  {/if}

  {#if details}
    <div>
      <h4 class="text-base-content/70 mb-2 text-xs font-semibold tracking-wide uppercase">
        {m.storage_details_versioning()}
      </h4>
      <div class="flex items-center gap-2">
        {#if details.versioningEnabled}
          <span class="badge badge-success badge-sm">{versioningLabel(true)}</span>
        {:else}
          <span class="badge badge-sm">{versioningLabel(false)}</span>
        {/if}
      </div>
    </div>

    {#if details.lifecycleRules.length > 0}
      <div>
        <h4 class="text-base-content/70 mb-2 text-xs font-semibold tracking-wide uppercase">
          {m.storage_details_lifecycle_rules()}
        </h4>
        <div class="flex flex-col gap-3">
          {#each details.lifecycleRules as rule (rule.id)}
            <div class="border-base-300 rounded-box border p-3">
              <div class="mb-2 flex items-center gap-2">
                <span class="text-sm font-medium">{rule.id || '(unnamed)'}</span>
                <span
                  class="badge badge-xs {rule.status === 'Enabled'
                    ? 'badge-success'
                    : 'badge-ghost'}"
                >
                  {rule.status}
                </span>
              </div>

              {#if rule.expirations.length > 0}
                <div class="text-base-content/70 mb-1 text-xs">
                  <IconInfo class="inline size-3 align-text-bottom" aria-hidden="true" />
                  {m.storage_details_lifecycle_expiration()}:
                  {#each rule.expirations as exp (exp.days ?? exp.date ?? '')}
                    <span class="text-base-content font-mono text-xs">
                      {#if exp.days !== undefined}
                        {m.storage_details_lifecycle_days({ days: exp.days })}
                      {:else if exp.date}
                        {exp.date}
                      {:else if exp.expiredObjectDeleteMarker}
                        {m.storage_details_yes()}
                      {/if}
                    </span>
                  {/each}
                </div>
              {/if}

              {#if rule.noncurrentVersionExpirations.length > 0}
                <div class="text-base-content/70 text-xs">
                  <IconInfo class="inline size-3 align-text-bottom" aria-hidden="true" />
                  {m.storage_details_lifecycle_noncurrent_expiration()}:
                  {#each rule.noncurrentVersionExpirations as nve (nve.noncurrentDays)}
                    <span class="text-base-content font-mono text-xs">
                      {m.storage_details_lifecycle_days({ days: nve.noncurrentDays })}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else if !loading}
      <div class="border-base-300 flex items-center gap-2 rounded-lg border p-3 text-sm">
        <IconInfo class="text-base-content/40 size-4" aria-hidden="true" />
        <span class="text-base-content/60">{m.storage_details_lifecycle_no_rules()}</span>
      </div>
    {/if}

    {#if details.tags && Object.keys(details.tags).length > 0}
      <div>
        <h4 class="text-base-content/70 mb-2 text-xs font-semibold tracking-wide uppercase">
          {m.storage_details_tags()}
        </h4>
        <div class="flex flex-wrap gap-2">
          {#each Object.entries(details.tags) as [key, value] (key)}
            <span class="badge badge-outline badge-sm gap-1">
              <span class="font-medium">{key}</span>: {value}
            </span>
          {/each}
        </div>
      </div>
    {:else if !loading}
      <div class="text-base-content/40 text-sm italic">{m.storage_details_no_tags()}</div>
    {/if}
  {/if}
</div>
