<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';

  const storage = getStorageState();
  storage.loading = false;

  const bucket = $derived(page.params.bucket ?? '');

  const prefixParts = $derived.by(() => {
    const segments = page.url?.pathname?.split('/').filter(Boolean) ?? [];
    return decodeURIComponent(segments.slice(4).join('/') || '');
  });

  function bucketErrorMessage(status: number, name: string): string | null {
    if (!name) return null;
    if (status === 403) return m.storage_error_access_denied({ bucket: name });
    if (status === 404) return m.storage_error_not_found({ bucket: name });
    if (status === 502) return m.storage_error_storage_error({ bucket: name });
    return null;
  }

  const errorMessage = $derived(bucketErrorMessage(page.status, bucket));
</script>

<div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
  <div class="border-base-300 flex items-center gap-3 border-b px-6 py-3">
    <nav
      aria-label={m.storage_error_breadcrumb()}
      class="flex min-w-0 flex-1 items-center gap-1 text-sm"
    >
      <span class="flex shrink-0 items-center gap-1">
        <a
          href={resolve('/(app)/storage/browse/[connection]/[bucket]/[...prefix]', {
            connection: encodeURIComponent(storage.connectionHostname),
            bucket: encodeURIComponent(bucket),
            prefix: ''
          })}
          class="text-base-content/70 hover:bg-base-200 hover:text-base-content flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-colors"
        >
          <IconStorage class="size-4" aria-hidden="true" />
          {bucket}
        </a>
      </span>
      {#if prefixParts}
        <IconChevronRight class="text-base-content/30 size-4 shrink-0" aria-hidden="true" />
        <span class="text-base-content/50 min-w-0 truncate">{prefixParts}</span>
      {/if}
    </nav>
  </div>

  <div
    class="
      flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center
    "
  >
    <div
      class="
        bg-error/10 text-error flex size-20 items-center justify-center
        rounded-full
      "
      aria-hidden="true"
    >
      <IconWarning class="size-10" aria-hidden="true" />
    </div>

    <div>
      <p
        class="
          text-base-content/50 mb-1 text-sm font-medium tracking-widest uppercase
        "
      >
        {m.storage_error_title()}
      </p>
      <h1 class="text-base-content text-3xl font-bold">
        {page.status}
      </h1>
      <p class="text-base-content/70 mt-2 max-w-sm text-sm">
        {errorMessage ?? page.error?.message ?? ''}
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-3">
      <a href="/storage" class="btn btn-sm btn-primary">
        {m.storage_error_back_to_storage()}
      </a>
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => history.back()}>
        {m.storage_error_go_back()}
      </button>
    </div>
  </div>
</div>
