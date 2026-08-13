<script lang="ts">
  import { navigating } from '$app/state';
  import { getNavSections } from '$lib/components/layout/sidebar/nav-items.js';
  import * as m from '$lib/paraglide/messages.js';

  // Show navigation progress bar when navigating between different app roots.
  // Otherwise, add exceptions to this if you want navigation progress inside a specific app.
  const appRoots = $derived(
    getNavSections({ storageBrowserEnabled: true }).flatMap((section) =>
      section.items.map((item) => item.href)
    )
  );

  function appRootOf(pathname: string | null): string | null {
    if (!pathname) return null;
    const sub = appRoots.find((root) => root !== '/' && pathname.startsWith(root));
    if (sub) return sub;
    return pathname === '/' ? '/' : null;
  }

  const fromRoot = $derived(appRootOf(navigating.from?.url.pathname ?? null));
  const toRoot = $derived(appRootOf(navigating.to?.url.pathname ?? null));

  const active = $derived(fromRoot !== null && toRoot !== null && fromRoot !== toRoot);
</script>

{#if active}
  <div
    class="bg-primary/25 pointer-events-none fixed inset-x-0 top-0 z-100 h-[3px] overflow-hidden"
    role="status"
    aria-live="polite"
    data-navigation-progress
  >
    <div
      class="bg-primary h-full w-[40%] animate-[nav-progress-slide_1.1s_ease-in-out_infinite] rounded-full motion-reduce:w-full motion-reduce:animate-none"
      aria-hidden="true"
    ></div>
    <span class="sr-only">{m.navigation_loading()}</span>
  </div>
{/if}
