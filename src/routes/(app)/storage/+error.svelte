<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import * as m from '$lib/paraglide/messages.js';

  // page.params.bucket may be absent when a client-side universal load throws an
  // error (the error boundary sits at the parent /storage level, and SvelteKit
  // may not populate child-route params on the page store in that case).
  // Fall back to parsing the bucket segment directly from the URL path.
  const bucket = $derived(
    page.params.bucket ||
      decodeURIComponent(page.url?.pathname?.split('/').filter(Boolean)[1] ?? '')
  );

  function bucketErrorMessage(status: number, name: string): string | null {
    if (!name) return null;
    if (status === 403) return m.storage_error_access_denied({ bucket: name });
    if (status === 404) return m.storage_error_not_found({ bucket: name });
    if (status === 502) return m.storage_error_storage_error({ bucket: name });
    return null;
  }

  const errorMessage = $derived(bucketErrorMessage(page.status, bucket));
</script>

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
    role="img"
    aria-label={m.storage_error_warning_icon_label()}
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
    <a href={resolve('/storage')} class="btn btn-sm btn-primary">
      {m.storage_error_back_to_storage()}
    </a>
    <button type="button" class="btn btn-ghost btn-sm" onclick={() => history.back()}>
      {m.storage_error_go_back()}
    </button>
  </div>
</div>
