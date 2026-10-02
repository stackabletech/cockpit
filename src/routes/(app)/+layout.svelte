<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import Sidebar from '$lib/components/layout/sidebar/Sidebar.svelte';
  import Header from '$lib/components/layout/header/Header.svelte';
  import ToastHost from '$lib/components/ToastHost.svelte';

  let { children, data } = $props();

  function getInitialCollapsed(): boolean {
    if (!browser) return false;
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  }

  let sidebarCollapsed = $state(getInitialCollapsed());
  let mobileOpen = $state(false);

  $effect(() => {
    if (!browser) return;
    localStorage.setItem('sidebar_collapsed', String(sidebarCollapsed));
  });

  const pageTitles: Record<string, () => string> = {
    '/': m.page_title_dashboard,
    '/trino': m.page_title_trino
  };

  let title = $derived(
    (
      pageTitles[page.url.pathname] ??
      (page.url.pathname.startsWith('/storage') ? m.page_title_storage : m.page_title_default)
    )()
  );
</script>

<svelte:head>
  <title>{title} | {m.page_title_suffix()}</title>
</svelte:head>

<div class="bg-base-100 flex h-dvh overflow-hidden">
  <!-- Bypass block (WCAG 2.4.1): first tab stop on every page. -->
  <a
    href="#main-content"
    class="
      btn btn-primary btn-sm sr-only
      focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100
    "
  >
    {m.skip_to_content()}
  </a>

  <Sidebar
    bind:collapsed={sidebarCollapsed}
    bind:mobileOpen
    storageBrowserEnabled={data.storageBrowserEnabled}
  />

  <div class="flex min-w-0 flex-1 flex-col">
    <Header
      {title}
      {mobileOpen}
      user={data.user}
      onToggleMobile={() => (mobileOpen = !mobileOpen)}
    />

    <main
      id="main-content"
      tabindex="-1"
      class="bg-base-200 flex-1 overflow-auto p-6 focus:outline-none"
    >
      {@render children()}
    </main>
  </div>
</div>

<ToastHost />
