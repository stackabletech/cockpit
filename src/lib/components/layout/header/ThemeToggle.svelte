<script lang="ts">
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages.js';
  import Icon from '@iconify/svelte';

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

<label class="swap swap-rotate">
  <!-- this hidden checkbox controls the state -->
  <input
    type="checkbox"
    class="theme-controller"
    bind:checked={dark}
    aria-label={dark ? m.theme_switch_light() : m.theme_switch_dark()}
  />

  <!-- sun icon (visible when unchecked) -->
  <Icon icon="material-symbols:light-mode" class="swap-off size-5" aria-hidden="true" />

  <!-- moon icon (visible when checked) -->
  <Icon icon="material-symbols:dark-mode" class="swap-on size-5" aria-hidden="true" />
</label>
