<script lang="ts">
  import { page } from '$app/state';
  import ErrorPanel from '$lib/components/ErrorPanel.svelte';
</script>

<!-- Only reached when the (app) layout itself fails, e.g. its server load throws. -->
<main class="bg-base-200 flex min-h-dvh flex-col">
  <ErrorPanel status={page.status} requestId={page.error?.requestId} headingLevel="h1" />
</main>
