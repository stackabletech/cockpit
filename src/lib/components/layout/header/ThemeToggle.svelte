<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import IconLightMode from 'virtual:icons/material-symbols/light-mode';
  import IconDarkMode from 'virtual:icons/material-symbols/dark-mode';

  function prefersDark(): boolean {
    if (!browser) return false;
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Theme is only known clientside so the button is hidden until its state is known
  let mounted = $state(false);
  let dark = $state(prefersDark());

  onMount(() => {
    mounted = true;
  });

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
  aria-label={mounted ? (dark ? m.theme_switch_light() : m.theme_switch_dark()) : m.theme_toggle()}
  disabled={!mounted}
>
  <div hidden={!mounted}>
    {#if dark}
      <IconLightMode class="h-5 w-5" aria-hidden="true" />
    {:else}
      <IconDarkMode class="h-5 w-5" aria-hidden="true" />
    {/if}
  </div>
</button>
