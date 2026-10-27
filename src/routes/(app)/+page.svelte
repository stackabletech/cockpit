<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import DashboardBookmarks from '$lib/components/dashboard/DashboardBookmarks.svelte';

  let { data } = $props();
</script>

<div class="mx-auto max-w-6xl space-y-5">
  <h2 class="text-base-content text-2xl font-bold tracking-tight">{m.dashboard_welcome()}</h2>

  <!-- Null when bookmarks are unavailable (no signed-in user, or loading them
     failed): the whole bookmark section is hidden. -->
  {#if data.bookmarks}
    <DashboardBookmarks bookmarks={data.bookmarks} />
  {/if}
</div>
