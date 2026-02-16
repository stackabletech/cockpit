<script lang="ts">
  import ThemeToggle from './ThemeToggle.svelte';

  let {
    title = 'Dashboard',
    mobileOpen = false,
    onToggleMobile
  }: {
    title?: string;
    mobileOpen?: boolean;
    onToggleMobile?: () => void;
  } = $props();
</script>

<header
  class="border-base-300 bg-base-100 flex h-16 shrink-0 items-center gap-4 border-b px-4 lg:px-6"
>
  <!-- Mobile menu button -->
  <button
    class="btn btn-ghost btn-sm btn-square lg:hidden"
    onclick={onToggleMobile}
    aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
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
    <ThemeToggle />
    <button class="btn btn-ghost btn-circle" aria-label="User menu">
      <span class="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-full">
        <svg
          class="text-primary h-4 w-4"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21a8 8 0 0 0-16 0" />
        </svg>
      </span>
    </button>
  </div>
</header>
