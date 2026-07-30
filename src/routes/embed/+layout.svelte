<script lang="ts">
  import ToastHost from '$lib/components/ToastHost.svelte';

  let { children } = $props();
</script>

<!--
  Embed layout: a full-viewport shell with no sidebar or header.
  All routes under /embed/* use this layout so they can be loaded inside
  an <iframe> by any host frontend.

  Cross-origin embedding notes:
  - The session cookie must be SameSite=None; Secure when the embedding page
    is on a different origin.  Configure this in src/lib/server/auth.ts
    advanced.cookies before deploying to production.
  - The embedding page and this server must be on HTTPS for SameSite=None to
    work (browsers reject SameSite=None without Secure).
  - See TECH_DEBT.md for the outstanding work item.
-->
<div class="bg-base-100 flex h-dvh overflow-hidden">
  <main class="bg-base-200 flex-1 overflow-auto p-6">
    {@render children()}
  </main>
</div>

<ToastHost />
