<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import type { Component } from 'svelte';
  import IconChevronLeft from 'virtual:icons/material-symbols/chevron-left';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import IconExpandMore from 'virtual:icons/material-symbols/expand-more';
  import IconArrowOutward from 'virtual:icons/material-symbols/arrow-outward';
  import type { NavItem } from '$lib/types/navigation.js';
  import { getPlatformSection, getToolsSection } from './nav-items.js';
  import { getBookmarks } from '$lib/dashboard/bookmarks.svelte.js';
  import { PRODUCTS } from '$lib/dashboard/products';
  import type { Bookmark } from '$lib/dashboard/types';

  let {
    collapsed = $bindable(false),
    mobileOpen = $bindable(false),
    storageBrowserEnabled = false
  }: {
    collapsed?: boolean;
    mobileOpen?: boolean;
    storageBrowserEnabled?: boolean;
  } = $props();

  const platformSection = $derived(getPlatformSection());
  const toolsSection = $derived(getToolsSection({ storageBrowserEnabled }));

  const bookmarks = $derived(getBookmarks());
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
    localStorage.setItem('sidebar_tools_open', String(toolsOpen));
  });

  function isActive(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    return page.url.pathname.startsWith(href);
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

  function getProduct(productId: string) {
    return PRODUCTS.find((p) => p.id === productId) ?? PRODUCTS[PRODUCTS.length - 1];
  }

  function handleLogoError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling;
    if (next) next.classList.remove('hidden');
  }

  let sidebarEl: HTMLElement | undefined = $state();
</script>

{#snippet navIcon(IconComponent: Component)}
  <IconComponent class="h-5 w-5 shrink-0" aria-hidden="true" />
{/snippet}

{#snippet bookmarkIcon(bookmark: Bookmark)}
  {@const product = getProduct(bookmark.productId)}
  {#if product.logo}
    <enhanced:img
      src={product.logo}
      alt=""
      class="size-5 shrink-0 rounded-full bg-white object-contain p-0.5"
      onerror={handleLogoError}
    />
    <span
      class="flex hidden size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style="background-color: {product.color}"
    >
      {product.initials}
    </span>
  {:else}
    <span
      class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style="background-color: {product.color}"
    >
      {product.initials}
    </span>
  {/if}
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
  id="sidebar"
  aria-label={m.sidebar_label()}
  class="border-base-300 bg-base-200 fixed inset-y-0 left-0 z-50 flex flex-col border-r
    transition-[transform,width] duration-200 ease-out
    lg:relative lg:inset-auto lg:z-auto lg:translate-x-0
    {mobileOpen ? 'translate-x-0' : '-translate-x-full'}
    {collapsed ? 'w-16' : 'w-60'}"
>
  <!-- Brand -->
  <div class="border-base-300 flex h-16 shrink-0 items-center gap-3 border-b px-4">
    <img src="/stackable-logo-bimi-v2.svg" alt="" class="h-7 w-7 shrink-0" />
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
        {@const active = isActive(item.href)}
        <li>
          <a
            href={item.href}
            onclick={(e) => handleNavClick(e, item)}
            onkeydown={(e) => handleNavKeydown(e, item)}
            title={collapsed ? item.label : undefined}
            class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
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
        </li>
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
          {@const href = `/bookmark/${bookmark.id}`}
          {@const active = isActive(href)}
          <li class="group relative">
            <a
              {href}
              onclick={() => (mobileOpen = false)}
              title={collapsed ? bookmark.name : undefined}
              class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                {active
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/70 hover:bg-base-content/5 hover:text-base-content'}
                {collapsed ? 'justify-center' : 'pr-9'}"
              aria-current={active ? 'page' : undefined}
            >
              <span class="flex shrink-0 items-center">
                {@render bookmarkIcon(bookmark)}
              </span>
              {#if !collapsed}
                <span class="truncate">{bookmark.name}</span>
              {/if}
            </a>
            {#if !collapsed}
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-base-content/60 hover:bg-base-content/10 hover:text-base-content absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
                aria-label={m.sidebar_bookmark_open_external()}
                title={m.sidebar_bookmark_open_external()}
              >
                <IconArrowOutward class="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            {/if}
          </li>
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
        aria-label={toolsOpen ? m.sidebar_tools_collapse() : m.sidebar_tools_expand()}
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
          {@const active = isActive(item.href)}
          <li>
            <a
              href={item.href}
              onclick={(e) => handleNavClick(e, item)}
              onkeydown={(e) => handleNavKeydown(e, item)}
              title={collapsed ? item.label : undefined}
              class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
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
          </li>
        {/each}
        {#each unpinnedBookmarks as bookmark (bookmark.id)}
          {@const href = `/bookmark/${bookmark.id}`}
          {@const active = isActive(href)}
          <li class="group relative">
            <a
              {href}
              onclick={() => (mobileOpen = false)}
              title={collapsed ? bookmark.name : undefined}
              class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                {active
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/70 hover:bg-base-content/5 hover:text-base-content'}
                {collapsed ? 'justify-center' : 'pr-9'}"
              aria-current={active ? 'page' : undefined}
            >
              <span class="flex shrink-0 items-center">
                {@render bookmarkIcon(bookmark)}
              </span>
              {#if !collapsed}
                <span class="truncate">{bookmark.name}</span>
              {/if}
            </a>
            {#if !collapsed}
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-base-content/60 hover:bg-base-content/10 hover:text-base-content absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
                aria-label={m.sidebar_bookmark_open_external()}
                title={m.sidebar_bookmark_open_external()}
              >
                <IconArrowOutward class="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </nav>

  <!-- Footer: collapse toggle (desktop only) -->
  <div class="border-base-300 hidden shrink-0 border-t p-3 lg:block">
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
  </div>
</aside>
