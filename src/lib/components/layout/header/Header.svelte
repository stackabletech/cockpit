<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import Icon from '@iconify/svelte';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import UserMenu from './UserMenu.svelte';
  import type { User } from '$lib/types/auth.js';

  let {
    title = m.page_title_dashboard(),
    mobileOpen = false,
    user = null,
    onToggleMobile
  }: {
    title?: string;
    mobileOpen?: boolean;
    user?: User | null;
    onToggleMobile?: () => void;
  } = $props();
</script>

<header
  class="
    border-base-300 bg-base-100 flex h-16 shrink-0 items-center gap-4 border-b
    px-4
    lg:px-6
  "
>
  <!-- Mobile menu button -->
  <button
    class="
      btn btn-square btn-ghost btn-sm
      lg:hidden
    "
    onclick={onToggleMobile}
    aria-label={mobileOpen ? m.header_close_nav() : m.header_open_nav()}
    aria-expanded={mobileOpen}
    aria-controls="sidebar"
  >
    <Icon icon="material-symbols:menu" class="size-5" aria-hidden="true" />
  </button>

  <h1 class="text-base-content text-lg font-semibold">{title}</h1>

  <div class="flex-1"></div>

  <div class="flex items-center gap-1">
    <LanguageSwitcher />
    <ThemeToggle />
    {#if user}
      <UserMenu {user} />
    {/if}
  </div>
</header>
