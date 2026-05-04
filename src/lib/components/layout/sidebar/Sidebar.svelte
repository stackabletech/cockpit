<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import Icon from '@iconify/svelte';
  import { type NavItem, getNavSections } from './nav-items.js';

  let {
    collapsed = $bindable(false),
    mobileOpen = $bindable(false)
  }: {
    collapsed?: boolean;
    mobileOpen?: boolean;
  } = $props();

  const sections = $derived(getNavSections());

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

  let sidebarEl: HTMLElement | undefined = $state();
</script>

{#snippet navIcon(name: string)}
  {@const iconName = `material-symbols:${name}`}
  <Icon icon={iconName} class="h-5 w-5 shrink-0" aria-hidden="true" />
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
  class="border-base-300 bg-base-100 fixed inset-y-0 left-0 z-50 flex flex-col border-r
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
    {#each sections as section, sectionIdx (section.title)}
      {#if sectionIdx > 0}
        <div class="my-3"></div>
      {/if}

      {#if !collapsed}
        <div class="text-base-content/60 mb-2 px-3 text-xs font-semibold tracking-wider uppercase">
          {section.title}
        </div>
      {/if}

      <ul class="flex flex-col gap-1">
        {#each section.items as item (item.label)}
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
    {/each}
  </nav>

  <!-- Footer: collapse toggle (desktop only) -->
  <div class="border-base-300 hidden shrink-0 border-t p-3 lg:block">
    <button
      onclick={() => (collapsed = !collapsed)}
      class="text-base-content/60 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-3 rounded-lg px-3 py-2
        text-sm font-medium transition-colors
        {collapsed ? 'justify-center' : ''}"
      aria-label={collapsed ? m.sidebar_expand() : m.sidebar_collapse()}
    >
      {#if collapsed}
        <Icon icon="material-symbols:chevron-right" class="h-4 w-4 shrink-0" aria-hidden="true" />
      {:else}
        <Icon icon="material-symbols:chevron-left" class="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{m.sidebar_collapse_label()}</span>
      {/if}
    </button>
  </div>
</aside>
