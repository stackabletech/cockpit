<script lang="ts">
  import DashboardBookmarks from '$lib/components/dashboard/DashboardBookmarks.svelte';

  let { data } = $props();
</script>

<div class="mx-auto max-w-6xl space-y-5">
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
