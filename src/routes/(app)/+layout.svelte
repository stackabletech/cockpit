<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import Sidebar from '$lib/components/layout/sidebar/Sidebar.svelte';
  import Header from '$lib/components/layout/header/Header.svelte';

  let { children, data } = $props();

  let sidebarCollapsed = $state(false);
  let mobileOpen = $state(false);

  const pageTitles: Record<string, () => string> = {
    '/': m.page_title_dashboard,
    '/trino': m.page_title_trino,
  };

  let title = $derived((pageTitles[page.url.pathname] ?? m.page_title_default)());
</script>

<svelte:head>
  <title>{title} | {m.page_title_suffix()}</title>
</svelte:head>

<div class="bg-base-100 flex h-dvh overflow-hidden">
  <Sidebar bind:collapsed={sidebarCollapsed} bind:mobileOpen />

  <div class="flex min-w-0 flex-1 flex-col">
    <Header
      {title}
      {mobileOpen}
      user={data.user}
      onToggleMobile={() => (mobileOpen = !mobileOpen)}
    />

    <main class="bg-base-200 flex-1 overflow-auto p-6">
      {@render children()}
    </main>
  </div>
</div>
