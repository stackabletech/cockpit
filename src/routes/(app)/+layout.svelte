<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import Sidebar from '$lib/components/layout/sidebar/Sidebar.svelte';
  import Header from '$lib/components/layout/header/Header.svelte';
  import ToastHost from '$lib/components/ToastHost.svelte';
  import SessionExpiredModal from '$lib/components/layout/SessionExpiredModal.svelte';

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

  function pageTitle(): () => string {
    // Unknown pages render the 404 of the catch-all route.
    if (page.route.id === '/(app)/[...path]') return m.error_not_found_title;
    return (
      pageTitles[page.url.pathname] ??
      (page.url.pathname.startsWith('/storage') ? m.page_title_storage : m.page_title_default)
    );
  }

  let title = $derived(pageTitle()());

  let mainEl: HTMLElement | undefined = $state();

  // <main> is only focusable while the skip link has sent focus there. A
  // permanent tabindex would let every click inside the page focus <main>,
  // which takes focus away from body and disables the file browser shortcuts.
  function skipToMain(event: MouseEvent) {
    // Leave modified clicks (open in new tab/window) to the browser.
    if (!mainEl || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    mainEl.setAttribute('tabindex', '-1');
    mainEl.addEventListener('blur', () => mainEl?.removeAttribute('tabindex'), { once: true });
    mainEl.focus();
  }
</script>

<svelte:head>
  <title>{title} | {m.page_title_suffix()}</title>
</svelte:head>

<div class="bg-base-100 flex h-dvh overflow-hidden">
  <!-- Bypass block (WCAG 2.4.1): first tab stop on every page. -->
  <a
    href="#main-content"
    onclick={skipToMain}
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
    bookmarks={data.bookmarks ?? []}
  />

  <div class="flex min-w-0 flex-1 flex-col">
    <Header
      {title}
      {mobileOpen}
      user={data.user}
      onToggleMobile={() => (mobileOpen = !mobileOpen)}
    />

    <main
      bind:this={mainEl}
      id="main-content"
      class="bg-base-200 flex-1 overflow-auto p-6 focus:outline-none"
    >
      {@render children()}
    </main>
  </div>
</div>

<ToastHost />

<!-- Only signed-in users can lose their session; without OIDC there is none. -->
{#if data.user}
  <SessionExpiredModal />
{/if}
