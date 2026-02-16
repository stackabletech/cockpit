<script lang="ts">
  import { page } from '$app/state';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import Header from '$lib/components/layout/Header.svelte';

  let { children } = $props();

  let sidebarCollapsed = $state(false);
  let mobileOpen = $state(false);

  const pageTitles: Record<string, string> = {
    '/': 'Dashboard'
  };

  let title = $derived(pageTitles[page.url.pathname] ?? 'Stackable');
</script>

<svelte:head>
  <title>{title} | Stackable</title>
</svelte:head>

<div class="bg-base-100 flex h-dvh overflow-hidden">
  <Sidebar bind:collapsed={sidebarCollapsed} bind:mobileOpen />

  <div class="flex min-w-0 flex-1 flex-col">
    <Header {title} {mobileOpen} onToggleMobile={() => (mobileOpen = !mobileOpen)} />

    <main class="bg-base-200 flex-1 overflow-auto p-6">
      {@render children()}
    </main>
  </div>
</div>
