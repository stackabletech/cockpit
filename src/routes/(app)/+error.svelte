<script lang="ts">
  import { page } from '$app/state';
  import ErrorPanel from '$lib/components/ErrorPanel.svelte';
</script>

<div class="flex h-full flex-col">
  <ErrorPanel status={page.status} requestId={page.error?.requestId} />
</div>
