<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { theme } from '$lib/theme.svelte';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

  let { children } = $props();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000
      }
    }
  });

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

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
