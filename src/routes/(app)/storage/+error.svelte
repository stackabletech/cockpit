<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import StorageErrorPanel from '$lib/components/storage/shared/StorageErrorPanel.svelte';

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

<StorageErrorPanel status={page.status} message={errorMessage ?? page.error?.message ?? ''} />
