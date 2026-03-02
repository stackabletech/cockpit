<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import { authClient } from '$lib/auth-client';

  type User = typeof authClient.$Infer.Session.user;

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

  const initials = $derived(
    user?.name
      ? user.name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : '?'
  );
</script>

<header
  class="border-base-300 bg-base-100 flex h-16 shrink-0 items-center gap-4 border-b px-4 lg:px-6"
>
  <!-- Mobile menu button -->
  <button
    class="btn btn-ghost btn-sm btn-square lg:hidden"
    onclick={onToggleMobile}
    aria-label={mobileOpen ? m.header_close_nav() : m.header_open_nav()}
    aria-expanded={mobileOpen}
    aria-controls="sidebar"
  >
    <svg
      class="h-5 w-5"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  </button>

  <h1 class="text-base-content text-lg font-semibold">{title}</h1>

  <div class="flex-1"></div>

  <div class="flex items-center gap-1">
    <LanguageSwitcher />
    <ThemeToggle />
    <div class="dropdown dropdown-end">
      <button tabindex="0" class="btn btn-ghost btn-circle" aria-label={m.header_user_menu()}>
        {#if user?.image}
          <img src={user.image} alt={user.name ?? ''} class="h-8 w-8 rounded-full object-cover" />
        {:else}
          <span
            class="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
            aria-hidden="true"
          >
            {initials}
          </span>
        {/if}
      </button>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <ul
        tabindex="0"
        class="dropdown-content menu bg-base-100 border-base-300 z-10 w-56 rounded-lg border p-1 shadow-lg"
      >
        {#if user}
          <li class="px-3 py-2">
            <p class="text-base-content truncate text-sm font-semibold">{user.name}</p>
            <p class="text-base-content/60 truncate text-xs">{user.email}</p>
          </li>
          <li><hr class="border-base-300 my-1" /></li>
        {/if}
        <li>
          <a href="/auth/logout" class="text-sm">
            <svg
              class="h-4 w-4"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {m.header_sign_out()}
          </a>
        </li>
      </ul>
    </div>
  </div>
</header>
