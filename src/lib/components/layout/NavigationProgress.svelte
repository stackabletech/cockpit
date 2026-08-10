<script lang="ts">
  import { navigating } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';

  const active = $derived(navigating.to !== null);
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
