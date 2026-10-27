<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import DashboardBookmarks from '$lib/components/dashboard/DashboardBookmarks.svelte';

  let { data } = $props();
</script>

<div class="mx-auto max-w-6xl space-y-5">
  <h2 class="text-base-content text-2xl font-bold tracking-tight">{m.dashboard_welcome()}</h2>

  <!-- Without a signed-in user there are no bookmarks and the section is hidden;
     when loading them failed, it says so. -->
  {#if data.bookmarks || data.bookmarksFailed}
    <DashboardBookmarks bookmarks={data.bookmarks} />
  {/if}
</div>
