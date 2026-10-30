<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import DashboardBookmarks from '$lib/components/dashboard/DashboardBookmarks.svelte';

  let { data } = $props();
</script>

<div class="mx-auto max-w-6xl space-y-5">
  <h2 class="text-base-content text-2xl font-bold tracking-tight">{m.dashboard_welcome()}</h2>

  <!-- Without a signed-in user only global bookmarks are shown, and without any
     the section is hidden; when loading the user's bookmarks failed, it says so. -->
  {#if data.bookmarks || data.bookmarksFailed || data.globalBookmarks.length > 0}
    <DashboardBookmarks
      bookmarks={data.bookmarks}
      globalBookmarks={data.globalBookmarks}
      loadFailed={data.bookmarksFailed}
    />
  {/if}
</div>
