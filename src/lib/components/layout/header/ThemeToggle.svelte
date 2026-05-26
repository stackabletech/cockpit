<script lang="ts">
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages.js';
  import IconLightMode from 'virtual:icons/material-symbols/light-mode';
  import IconDarkMode from 'virtual:icons/material-symbols/dark-mode';

  function prefersDark(): boolean {
    if (!browser) return false;
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  let dark = $state(prefersDark());

  $effect(() => {
    if (!browser) return;
    const theme = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  });
</script>

<button
  onclick={() => (dark = !dark)}
  class="btn btn-ghost btn-sm btn-square"
  aria-label={dark ? m.theme_switch_light() : m.theme_switch_dark()}
>
  {#if dark}
    <IconLightMode class="h-5 w-5" aria-hidden="true" />
  {:else}
    <IconDarkMode class="h-5 w-5" aria-hidden="true" />
  {/if}
</button>
