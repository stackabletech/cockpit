<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import IconStorage from 'virtual:icons/material-symbols/storage';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import * as m from '$lib/paraglide/messages.js';
  import ErrorPanel from '$lib/components/ErrorPanel.svelte';

  function safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // Path segments of /storage/browse/[connection]/[bucket]/[...prefix].
  const segments = $derived(page.url?.pathname?.split('/').filter(Boolean) ?? []);
  const isBrowseRoute = $derived(segments[0] === 'storage' && segments[1] === 'browse');

  // page.params may lack the child-route params when a client-side universal
  // load throws (the error boundary sits at the parent /storage level, and
  // SvelteKit does not always populate them in that case). Fall back to
  // parsing the segments directly from the URL path.
  const connection = $derived(
    page.params.connection || (isBrowseRoute ? safeDecode(segments[2] ?? '') : '')
  );
  const bucket = $derived(
    page.params.bucket || (isBrowseRoute ? safeDecode(segments[3] ?? '') : '')
  );

  const prefixParts = $derived(isBrowseRoute ? safeDecode(segments.slice(4).join('/')) : '');

  function bucketErrorMessage(status: number, name: string): string | null {
    if (!name) return null;
    if (status === 403) return m.storage_error_access_denied({ bucket: name });
    if (status === 404) return m.storage_error_not_found({ bucket: name });
    if (status === 502) return m.storage_error_storage_error({ bucket: name });
    return null;
  }

  const errorMessage = $derived(
    page.error?.reason === 'not-connected'
      ? m.storage_error_not_connected({ connection: page.error.connection ?? connection })
      : bucketErrorMessage(page.status, bucket)
  );
</script>

<div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
  <div class="border-base-300 flex items-center gap-3 border-b px-6 py-3">
    {#if connection && bucket}
      <nav
        aria-label={m.storage_error_breadcrumb()}
        class="flex min-w-0 flex-1 items-center gap-1 text-sm"
      >
        <span class="flex shrink-0 items-center gap-1">
          <a
            href={resolve('/(app)/storage/browse/[connection]/[bucket]/[...prefix]', {
              connection: encodeURIComponent(connection),
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
    {/if}
  </div>

  <ErrorPanel
    status={page.status}
    title={m.storage_error_title()}
    description={errorMessage ?? page.error?.message ?? ''}
  >
    {#snippet actions()}
      <a href={resolve('/(app)/storage')} class="btn btn-sm btn-primary">
        {m.storage_error_back_to_storage()}
      </a>
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => history.back()}>
        {m.storage_error_go_back()}
      </button>
    {/snippet}
  </ErrorPanel>
</div>
