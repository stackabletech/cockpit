<script lang="ts">
  import { browser } from '$app/environment';
  import { beforeNavigate } from '$app/navigation';
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

  // ── Embed mode ───────────────────────────────────────────────────────────
  // Loading any page with `?embed=1` hides the app shell (sidebar + header)
  // so the module can be embedded in an iframe of another frontend. The mode
  // is sticky per tab via sessionStorage so it survives full-page navigations
  // (e.g. form submissions), and the query parameter is kept in the URL for
  // client-side navigations via `beforeNavigate`.
  const EMBED_KEY = 'cockpit_embed';
  const embedParam = $derived(page.url.searchParams.get('embed') === '1');
  let embedSticky = $state(false);

  $effect(() => {
    if (!browser) return;
    if (embedParam) {
      try {
        sessionStorage.setItem(EMBED_KEY, '1');
      } catch {
        // sessionStorage unavailable (e.g. blocked); URL param still works
      }
      embedSticky = true;
    } else {
      try {
        embedSticky = sessionStorage.getItem(EMBED_KEY) === '1';
      } catch {
        embedSticky = false;
      }
    }
  });

  const isEmbed = $derived(embedParam || embedSticky);

  // Keep `?embed=1` in the URL for client-side navigations so reloads and
  // open-in-new-tab keep the embedded layout.
  beforeNavigate((nav) => {
    if (isEmbed && nav.to?.url) {
      nav.to.url.searchParams.set('embed', '1');
    }
  });
</script>

<svelte:head>
  <title>{title} | {m.page_title_suffix()}</title>
</svelte:head>

{#if isEmbed}
  <div class="bg-base-100 flex h-dvh overflow-hidden">
    <main class="bg-base-200 flex-1 overflow-auto p-6">
      {@render children()}
    </main>
  </div>
{:else}
  <div class="bg-base-100 flex h-dvh overflow-hidden">
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

      <main class="bg-base-200 flex-1 overflow-auto p-6">
        {@render children()}
      </main>
    </div>
  </div>
{/if}

<ToastHost />
