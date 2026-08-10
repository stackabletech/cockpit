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

  // Session heartbeat (iframe-spike §4.6/§4.7). Polls COCKPIT's own session and, if it has lapsed,
  // re-authenticates at the TOP level (full-page, where the IdP can render) — so expiry never lands
  // as an X-Frame-Options-blocked login inside an embedded product's iframe. It checks Cockpit only,
  // never the embedded product, so a broken/unreachable product cannot trigger it. Guards: ignore
  // transient fetch failures (retry next tick), and only redirect on a definitive "no session".
  $effect(() => {
    if (!browser) return;
    let stopped = false;
    async function check() {
      try {
        const res = await fetch(
          '/api/auth/get-session?disableCookieCache=true&disableRefresh=true',
          {
            credentials: 'same-origin',
            headers: { accept: 'application/json' }
          }
        );
        if (!res.ok) return; // transient (5xx / offline) — leave the session alone, retry next tick
        const session = await res.json().catch(() => null);
        if (!session?.user && !stopped) {
          stopped = true;
          const here = page.url.pathname + page.url.search;
          window.location.href = `/auth/login?redirectTo=${encodeURIComponent(here)}`;
        }
      } catch {
        // network blip — ignore, retry next tick
      }
    }
    const id = setInterval(check, 20_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  });

  const pageTitles: Record<string, () => string> = {
    '/': m.page_title_dashboard,
    '/trino': m.page_title_trino,
    '/trino-console': m.page_title_trino_console
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

<ToastHost />
