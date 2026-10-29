<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import ErrorPanel from '$lib/components/ErrorPanel.svelte';

  // The dashboard requires sign-in, so linking there from a failing sign-in
  // page would only send the user back here.
  const isAuthPage = $derived(page.url.pathname.startsWith('/auth/'));
</script>

<!-- Errors of the auth pages and of the (app) layout itself. -->
<main class="bg-base-200 flex min-h-dvh flex-col">
  {#if isAuthPage}
    <ErrorPanel status={page.status} requestId={page.error?.requestId} headingLevel="h1">
      {#snippet actions()}
        <button type="button" class="btn btn-sm btn-primary" onclick={() => location.reload()}>
          {m.error_retry()}
        </button>
      {/snippet}
    </ErrorPanel>
  {:else}
    <ErrorPanel status={page.status} requestId={page.error?.requestId} headingLevel="h1" />
  {/if}
</main>
