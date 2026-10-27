<script lang="ts">
  import { resolve } from '$app/paths';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import type { Component } from 'svelte';
  import IconChevronLeft from 'virtual:icons/material-symbols/chevron-left';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import IconExpandMore from 'virtual:icons/material-symbols/expand-more';
  import { MediaQuery } from 'svelte/reactivity';
  import type { NavItem } from '$lib/types/navigation.js';
  import { getPlatformSection, getToolsSection } from './nav-items.js';
  import { getProduct } from '$lib/dashboard/products';
  import ProductIcon from '$lib/components/dashboard/ProductIcon.svelte';
  import type { Bookmark } from '$lib/dashboard/types';
  import stackableLogo from '$lib/logos/stackable.svg?enhanced';
  import TooltipTrigger from '$lib/components/TooltipTrigger.svelte';

  let {
    collapsed = $bindable(false),
    mobileOpen = $bindable(false),
    storageBrowserEnabled = false,
    bookmarks = []
  }: {
    collapsed?: boolean;
    mobileOpen?: boolean;
    storageBrowserEnabled?: boolean;
    bookmarks?: Bookmark[];
  } = $props();

  const platformSection = $derived(getPlatformSection());
  const toolsSection = $derived(getToolsSection({ storageBrowserEnabled }));

  const pinnedBookmarks = $derived(bookmarks.filter((b) => b.pinned));
  const unpinnedBookmarks = $derived(bookmarks.filter((b) => !b.pinned));

  function getInitialToolsOpen(): boolean {
    if (!browser) return true;
    try {
      return localStorage.getItem('sidebar_tools_open') !== 'false';
    } catch {
      return true;
    }
  }

  let toolsOpen = $state(getInitialToolsOpen());

  $effect(() => {
    if (!browser) return;
    try {
      localStorage.setItem('sidebar_tools_open', String(toolsOpen));
    } catch {
      // Storage blocked or full: the state only lasts for this session.
    }
  });

  // make mobile navbar not focusable if its hidden
  const isDesktop = new MediaQuery('min-width: 64rem', true);
  const hiddenFromUser = $derived(!isDesktop.current && !mobileOpen);

  // Explicitly derive currentPath so Svelte 5 tracks page.url.pathname
  // as a reactive dependency. Without this, changes to page.url.pathname
  // may not reliably trigger re-renders in all browsers during hydration.
  const currentPath = $derived(page.url.pathname);

  function isActive(href: string): boolean {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  }

  function handleNavClick(event: MouseEvent, item: NavItem) {
    if (item.disabled) {
      event.preventDefault();
      return;
    }
    mobileOpen = false;
  }

  function handleNavKeydown(event: KeyboardEvent, item: NavItem) {
    if (item.disabled && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  }

  let sidebarEl: HTMLElement | undefined = $state();

  $effect(() => {
    if (isDesktop.current || !mobileOpen || !sidebarEl) return;
    sidebarEl.focus();
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (isDesktop.current || !mobileOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      mobileOpen = false;
    }
  }

  // Tabbing off either end of the open panel would land on the page behind the
  // backdrop, so send focus back to the top of the panel instead.
  function handleFocusOut(event: FocusEvent) {
    if (isDesktop.current || !mobileOpen) return;

    const next = event.relatedTarget as Node | null;
    if (next && sidebarEl?.contains(next)) return;

    sidebarEl?.focus();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#snippet navIcon(IconComponent: Component)}
  <IconComponent class="h-5 w-5 shrink-0" aria-hidden="true" />
{/snippet}

{#snippet navItem(item: NavItem)}
  {@const active = isActive((resolve as (pathname: string) => string)(item.route))}
  <li>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Nav item paths are dynamically generated. -->
    <TooltipTrigger text={collapsed ? item.label : undefined} orientation="right">
      <a
        href={(resolve as (pathname: string) => string)(item.route)}
        data-sveltekit-preload-data="hover"
        onclick={(e) => handleNavClick(e, item)}
        onkeydown={(e) => handleNavKeydown(e, item)}
        aria-label={collapsed ? item.label : undefined}
        class="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
          {active
          ? 'bg-primary/10 text-primary'
          : 'text-base-content/70 hover:bg-base-content/5 hover:text-base-content'}
          {item.disabled ? 'opacity-40' : ''}
          {collapsed ? 'justify-center' : ''}"
        aria-current={active ? 'page' : undefined}
        aria-disabled={item.disabled ? 'true' : undefined}
      >
        {@render navIcon(item.icon)}
        {#if !collapsed}
          <span class="truncate">{item.label}</span>
          {#if item.badge}
            <span
              class="bg-base-300 text-base-content/60 ml-auto rounded-md px-1.5 py-0.5 text-xs font-semibold tracking-wider uppercase"
            >
              {item.badge}
            </span>
          {/if}
        {/if}
      </a>
    </TooltipTrigger>
  </li>
{/snippet}

{#snippet bookmarkIcon(bookmark: Bookmark)}
  {@const product = getProduct(bookmark.productId)}
  <ProductIcon {product} alt={product.name} />
{/snippet}

{#snippet bookmarkItem(bookmark: Bookmark)}
  <li>
    <TooltipTrigger text={collapsed ? bookmark.name : undefined} orientation="right">
      <a
        href={bookmark.url}
        target="_blank"
        rel="external noopener noreferrer"
        onclick={() => (mobileOpen = false)}
        aria-label={collapsed ? bookmark.name : undefined}
        class="text-base-content/70 hover:bg-base-content/5 hover:text-base-content flex min-h-11 items-center gap-3 rounded-lg px-3 py-2
          text-sm font-medium transition-colors
          {collapsed ? 'justify-center' : ''}"
      >
        <span class="flex shrink-0 items-center">
          {@render bookmarkIcon(bookmark)}
        </span>
        {#if !collapsed}
          <span class="truncate">{bookmark.name}</span>
        {/if}
      </a>
    </TooltipTrigger>
  </li>
{/snippet}

<!-- Mobile backdrop -->
{#if mobileOpen}
  <button
    class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
    onclick={() => (mobileOpen = false)}
    aria-label={m.sidebar_close_nav()}
    tabindex="-1"
  ></button>
{/if}

<!-- Sidebar -->
<aside
  bind:this={sidebarEl}
  onfocusout={handleFocusOut}
  id="sidebar"
  aria-label={m.sidebar_label()}
  tabindex="-1"
  inert={hiddenFromUser}
  class="border-base-300 bg-base-200 fixed inset-y-0 left-0 z-50 flex flex-col border-r
    transition-[transform,width] duration-200 ease-out
    lg:relative lg:inset-auto lg:z-auto lg:translate-x-0
    {mobileOpen ? 'translate-x-0' : '-translate-x-full'}
    {collapsed ? 'w-16' : 'w-60'}"
>
  <!-- Brand -->
  <div class="border-base-300 flex h-16 shrink-0 items-center gap-3 border-b px-4">
    <enhanced:img
      src={stackableLogo}
      alt={collapsed ? m.page_title_default() : ''}
      class="h-7 w-7 shrink-0"
    />
    {#if !collapsed}
      <span class="text-base-content text-lg font-bold tracking-tight">Stackable</span>
    {/if}
  </div>

  <!-- Navigation -->
  <nav
    class="flex-1 overflow-x-hidden overflow-y-auto px-3 py-4"
    aria-label={m.sidebar_nav_label()}
  >
    <!-- Platform -->
    {#if !collapsed}
      <div class="text-base-content/60 mb-2 px-3 text-xs font-semibold tracking-wider uppercase">
        {platformSection.title}
      </div>
    {/if}
    <ul class="flex flex-col gap-1">
      {#each platformSection.items as item (item.label)}
        {@render navItem(item)}
      {/each}
    </ul>

    <!-- Favourites (pinned bookmarks) -->
    {#if pinnedBookmarks.length > 0}
      <div class="my-3"></div>
      {#if !collapsed}
        <div class="text-base-content/60 mb-2 px-3 text-xs font-semibold tracking-wider uppercase">
          {m.sidebar_favourites()}
        </div>
      {/if}
      <ul class="flex flex-col gap-1">
        {#each pinnedBookmarks as bookmark (bookmark.id)}
          {@render bookmarkItem(bookmark)}
        {/each}
      </ul>
    {/if}

    <!-- Tools (inbuilt tools + remaining bookmarks, collapsible) -->
    <div class="my-3"></div>
    {#if !collapsed}
      <button
        type="button"
        onclick={() => (toolsOpen = !toolsOpen)}
        class="text-base-content/60 hover:bg-base-content/5 hover:text-base-content mb-2 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider uppercase transition-colors hover:cursor-pointer"
        aria-expanded={toolsOpen}
      >
        {toolsSection.title}
        <IconExpandMore
          class="h-4 w-4 transition-transform {toolsOpen ? '' : 'rotate-180'}"
          aria-hidden="true"
        />
      </button>
    {/if}
    {#if toolsOpen || collapsed}
      <ul class="flex flex-col gap-1">
        {#each toolsSection.items as item (item.label)}
          {@render navItem(item)}
        {/each}
        {#each unpinnedBookmarks as bookmark (bookmark.id)}
          {@render bookmarkItem(bookmark)}
        {/each}
      </ul>
    {/if}
  </nav>

  <!-- Footer: collapse toggle (desktop only) -->
  <div class="border-base-300 hidden shrink-0 border-t p-3 lg:block">
    <TooltipTrigger text={collapsed ? m.sidebar_expand() : undefined} orientation="right">
      <button
        onclick={() => (collapsed = !collapsed)}
        class="text-base-content/60 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-3 rounded-lg px-3 py-2
          text-sm font-medium transition-colors hover:cursor-pointer
          {collapsed ? 'justify-center' : ''}"
        aria-label={collapsed ? m.sidebar_expand() : m.sidebar_collapse()}
      >
        {#if collapsed}
          <IconChevronRight class="h-4 w-4 shrink-0" aria-hidden="true" />
        {:else}
          <IconChevronLeft class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{m.sidebar_collapse_label()}</span>
        {/if}
      </button>
    </TooltipTrigger>
  </div>
</aside>
