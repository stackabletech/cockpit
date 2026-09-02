<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import { getBookmarks } from '$lib/dashboard/bookmarks.svelte.js';

  const id = $derived(page.params.id);
  const bookmark = $derived(getBookmarks().find((b) => b.id === id));
</script>

{#if bookmark}
  <iframe
    src={bookmark.url}
    title={bookmark.name}
    allow="fullscreen"
    class="border-base-300 h-[calc(100dvh-7rem)] w-full rounded-xl border bg-white"
  ></iframe>
{:else}
  <div class="flex h-full items-center justify-center">
    <div class="border-base-300 bg-base-100 rounded-xl border p-8 text-center">
      <p class="text-base-content text-lg font-semibold">{m.bookmark_not_found_title()}</p>
      <p class="text-base-content/60 mt-2 text-sm">{m.bookmark_not_found_message()}</p>
    </div>
  </div>
{/if}
