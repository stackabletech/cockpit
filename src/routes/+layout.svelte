<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { theme } from '$lib/theme.svelte';

  let { children } = $props();

  onMount(() => {
    document.body.classList.add('hydrated');

    const observer = new MutationObserver(() => {
      theme.current = document.documentElement.dataset.theme ?? 'dark';
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    return () => observer.disconnect();
  });
</script>

{@render children()}
